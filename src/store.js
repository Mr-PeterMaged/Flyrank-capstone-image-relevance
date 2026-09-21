import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { HttpError,notFound } from './schema.js';
export class Store {
  constructor(pool) { this.pool=pool; }
  async rows(sql,args=[]) { return (await this.pool.query(sql,args)).rows; }
  async one(sql,args=[]) { return (await this.rows(sql,args))[0]; }
  async ownerByEmail(email) { return this.one('SELECT * FROM owners WHERE email=$1',[email]); }
  async owner(email,hash) { return this.one('INSERT INTO owners(id,email,password_hash) VALUES($1,$2,$3) RETURNING id,email',[randomUUID(),email,hash]); }
  async session(hash,id) { await this.pool.query("INSERT INTO sessions VALUES($1,$2,now()+interval '1 day')",[hash,id]); }
  async authenticate(hash) { return this.one('SELECT owner_id FROM sessions WHERE token_hash=$1 AND expires_at>now()',[hash]); }
  async image(owner,id) { const row=await this.one('SELECT * FROM images WHERE owner_id=$1 AND id=$2',[owner,id]); if(!row) throw notFound(); return row; }
  async post(owner,id) { const row=await this.one('SELECT * FROM posts WHERE owner_id=$1 AND id=$2',[owner,id]); if(!row) throw notFound(); return row; }
  async addImage(owner,hash,filename,version) {
    return transaction(this.pool,async (c)=>{
      const result=await c.query('INSERT INTO images(id,owner_id,content_hash,filename) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,content_hash) DO NOTHING RETURNING *',[randomUUID(),owner,hash,filename]);
      const row=result.rows[0] || (await c.query('SELECT * FROM images WHERE owner_id=$1 AND content_hash=$2',[owner,hash])).rows[0];
      await this.enqueue(c,owner,'image',row.id,version);
      return {...row,replayed:!result.rowCount};
    });
  }
  async addPost(owner,body,key,hash,version) {
    return transaction(this.pool,async (c)=>{
      const result=await c.query('INSERT INTO posts(id,owner_id,title,content,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,request_key) DO NOTHING RETURNING *',[randomUUID(),owner,body.title,body.content,key,hash]);
      const row=result.rows[0] || (await c.query('SELECT * FROM posts WHERE owner_id=$1 AND request_key=$2',[owner,key])).rows[0];
      if(row.payload_hash!==hash) throw new HttpError(409,'idempotency_conflict','Key used for different post content');
      await this.enqueue(c,owner,'post',row.id,version);
      return {...row,replayed:!result.rowCount};
    });
  }
  async enqueue(c,owner,type,id,version) {
    const retired=await c.query("UPDATE jobs SET status='failed',last_error='pipeline_superseded',lease_token=NULL,lease_until=NULL WHERE owner_id=$1 AND target_type=$2 AND target_id=$3 AND version<>$4 AND status IN ('pending','processing') RETURNING id",[owner,type,id,version]);
    if(retired.rowCount)await c.query("UPDATE ai_calls SET status='interrupted',error_code='pipeline_superseded',finished_at=now() WHERE job_id=ANY($1::uuid[]) AND status='started'",[retired.rows.map(r=>r.id)]);
    const inserted=await c.query('INSERT INTO jobs(id,owner_id,target_type,target_id,version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,target_type,target_id,version) DO NOTHING',[randomUUID(),owner,type,id,version]);
    if(inserted.rowCount){const table=type==='image'?'images':'posts';await c.query(`UPDATE ${table} SET status='pending' WHERE id=$1 AND owner_id=$2`,[id,owner]);}
  }
  async claim(leaseMs,version=null) {
    return transaction(this.pool,async(c)=>{
      const {rows}=await c.query("SELECT * FROM jobs WHERE ($1::text IS NULL OR version=$1) AND ((status='pending' AND next_at<=now()) OR (status='processing' AND lease_until<=now())) ORDER BY next_at,id FOR UPDATE SKIP LOCKED LIMIT 1",[version]);
      if(!rows[0]) return null;
      return (await c.query("UPDATE jobs SET status='processing',attempts=attempts+1,lease_token=$2,lease_until=now()+($3*interval '1 millisecond') WHERE id=$1 RETURNING *",[rows[0].id,randomUUID(),leaseMs])).rows[0];
    });
  }
  async saveMetadata(job,metadata,flagged,model) {
    return transaction(this.pool,async(c)=>{
      const lease=await c.query("SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND status='processing' FOR UPDATE",[job.id,job.lease_token]);
      if(!lease.rowCount) throw new Error('lease_lost');
      await c.query('UPDATE images SET metadata=$3,flag_reason=$4,status=$5,metadata_model=$6 WHERE id=$1 AND owner_id=$2',[job.target_id,job.owner_id,metadata,flagged?'Low confidence or unknown subject':null,flagged?'flagged':'pending',model]);
      await c.query('DELETE FROM tags WHERE image_id=$1 AND owner_id=$2',[job.target_id,job.owner_id]);
      for(const tag of new Set([metadata.subject,metadata.category,...metadata.attributes])) await c.query('INSERT INTO tags VALUES($1,$2,$3)',[job.target_id,job.owner_id,tag]);
    });
  }
  async finish(job,embedding,model,flagged=false) {
    return transaction(this.pool,async(c)=>{
      const lease=await c.query("SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND status='processing' FOR UPDATE",[job.id,job.lease_token]);
      if(!lease.rowCount) return false;
      if(embedding) await c.query('INSERT INTO vectors(owner_id,target_type,target_id,model,dimensions,embedding) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,target_type,target_id,model) DO UPDATE SET embedding=EXCLUDED.embedding,dimensions=EXCLUDED.dimensions,created_at=now()',[job.owner_id,job.target_type,job.target_id,model,embedding.length,embedding]);
      const table=job.target_type==='image'?'images':'posts';
      await c.query(`UPDATE ${table} SET status=$3 WHERE id=$1 AND owner_id=$2`,[job.target_id,job.owner_id,flagged?'flagged':'ready']);
      await c.query("UPDATE jobs SET status='done',lease_until=NULL,lease_token=NULL,last_error=NULL WHERE id=$1",[job.id]);
      return true;
    });
  }
  async fail(job,code,maxAttempts,retryMs) {
    return transaction(this.pool,async(c)=>{
      const terminal=job.attempts>=maxAttempts || code==='budget_exceeded';
      const result=await c.query('UPDATE jobs SET status=$3,last_error=$4,next_at=now()+($5*interval \'1 millisecond\'),lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2 RETURNING id',[job.id,job.lease_token,terminal?'failed':'pending',code,retryMs]);
      if(terminal && result.rowCount) {
        const table=job.target_type==='image'?'images':'posts';
        await c.query(`UPDATE ${table} SET status='failed' WHERE id=$1 AND owner_id=$2`,[job.target_id,job.owner_id]);
      }
      return terminal && result.rowCount>0;
    });
  }
  async reserveCall(job,kind,model,config,estimate=0) {
    return transaction(this.pool,async(c)=>{
      await c.query('INSERT INTO daily_budgets(owner_id,day) VALUES($1,CURRENT_DATE) ON CONFLICT DO NOTHING',[job.owner_id]);
      const budget=(await c.query('SELECT * FROM daily_budgets WHERE owner_id=$1 AND day=CURRENT_DATE FOR UPDATE',[job.owner_id])).rows[0];
      if(budget.calls>=config.dailyCalls || Number(budget.reserved_usd)+estimate>config.dailyUsd) throw new HttpError(429,'budget_exceeded','Daily AI budget exhausted');
      await c.query('UPDATE daily_budgets SET calls=calls+1,reserved_usd=reserved_usd+$2 WHERE owner_id=$1 AND day=CURRENT_DATE',[job.owner_id,estimate]);
      const id=randomUUID();
      await c.query('INSERT INTO ai_calls(id,owner_id,job_id,target_id,kind,model,cost_usd) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,job.owner_id,job.id,job.target_id,kind,model,estimate]);
      return id;
    });
  }
  async closeCall(id,status,usage,duration,code=null) {
    await this.pool.query('UPDATE ai_calls SET status=$2,input_tokens=$3,output_tokens=$4,duration_ms=$5,error_code=$6,finished_at=now() WHERE id=$1',[id,status,usage?.input ?? null,usage?.output ?? null,duration,code]);
  }
  async matchingData(owner,postId,model) {
    const post=await this.post(owner,postId);
    const pv=await this.one("SELECT embedding FROM vectors WHERE owner_id=$1 AND target_type='post' AND target_id=$2 AND model=$3",[owner,postId,model]);
    if(post.status!=='ready'||!pv) throw new HttpError(409,'not_ready','Post embedding is not ready; inspect its job');
    const images=await this.rows("SELECT i.id,i.status,i.metadata,v.embedding AS vector FROM images i JOIN vectors v ON v.target_id=i.id AND v.owner_id=i.owner_id AND v.target_type='image' WHERE i.owner_id=$1 AND v.model=$2 ORDER BY i.id LIMIT 2000",[owner,model]);
    return {post:{...post,vector:pv.embedding},images};
  }
  async snapshot(owner,postId,ranked,thresholds) {
    return transaction(this.pool,async(c)=>{
      const id=randomUUID();
      await c.query('INSERT INTO match_runs(id,owner_id,post_id,config) VALUES($1,$2,$3,$4)',[id,owner,postId,thresholds]);
      const suggestions=[];
      for(let i=0;i<ranked.length;i++) {
        const r=ranked[i],suggestionId=randomUUID();
        await c.query('INSERT INTO suggestions(id,owner_id,run_id,post_id,image_id,rank,similarity,confidence,accepted,reasons) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[suggestionId,owner,id,postId,r.imageId,i+1,r.similarity,r.confidence,r.accepted,JSON.stringify(r.reasons)]);
        suggestions.push({...r,suggestionId});
      }
      return {runId:id,suggestions};
    });
  }
  async review(owner,id,body) {
    return transaction(this.pool,async(c)=>{
      const s=(await c.query('SELECT * FROM suggestions WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,owner])).rows[0];
      if(!s) throw notFound();
      if(body.decision==='approve'&&!s.accepted) throw new HttpError(409,'guard_rejected','A guard-rejected pairing cannot be approved');
      return (await c.query('INSERT INTO reviews(suggestion_id,owner_id,decision,note) VALUES($1,$2,$3,$4) ON CONFLICT(suggestion_id) DO UPDATE SET decision=EXCLUDED.decision,note=EXCLUDED.note,updated_at=now() RETURNING *',[id,owner,body.decision,body.note])).rows[0];
    });
  }
}
