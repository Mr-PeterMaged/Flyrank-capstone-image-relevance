import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { root } from './config.js';
import { parse,credentialsSchema,postSchema,pageSchema,reviewSchema,uuid,HttpError,notFound } from './schema.js';
import { digest,token,passwordHash,passwordMatches } from './security.js';
import { ingest,pipelineVersion } from './ingest.js';
import { rank,intent,guard,cosine } from './guard.js';
export function createApp(store,config,{logger=console}={}) {
  const app=express(); app.disable('x-powered-by');app.set('trust proxy',false);
  app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});next();});
  const authBuckets=new Map();
  app.use('/auth',(req,res,next)=>{
    const now=Date.now();for(const [key,value] of authBuckets)if(value.expiry<now)authBuckets.delete(key);
    const key=digest(req.ip);let b=authBuckets.get(key);
    if(!b){if(authBuckets.size>=10000)throw new HttpError(429,'busy','Please try later');b={count:0,expiry:now+60000};authBuckets.set(key,b);}
    if(++b.count>10){res.set('Retry-After','60');throw new HttpError(429,'rate_limited','Too many authentication attempts');}next();
  });
  app.use(express.json({limit:'32kb',strict:true}));
  const json=(req,res,next)=>{if(!req.is('application/json'))throw new HttpError(415,'content_type','Use application/json');next();};
  const auth=async(req,res,next)=>{
    const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('Authorization')||'');
    const session=match&&await store.authenticate(digest(match[1]));
    if(!session)throw new HttpError(401,'unauthorized','Valid bearer session required');
    req.owner=session.owner_id;req.sessionHash=digest(match[1]);next();
  };
  async function session(res,owner){const secret=token();await store.session(digest(secret),owner.id);res.json({token:secret,owner:{id:owner.id,email:owner.email},expiresIn:86400});}
  app.get('/health',async(req,res)=>{await store.pool.query('SELECT 1');res.json({status:'ok',provider:'ollama',visionModel:config.visionModel,embeddingModel:config.embeddingModel});});
  app.post('/auth/register',json,async(req,res)=>{
    const body=parse(credentialsSchema,req.body);const hash=await passwordHash(body.password);
    try{const owner=await store.owner(body.email,hash);await session(res.status(201),owner);}
    catch(error){if(error.code==='23505')throw new HttpError(409,'account_exists','Account exists');throw error;}
  });
  app.post('/auth/login',json,async(req,res)=>{
    const body=parse(credentialsSchema,req.body),owner=await store.ownerByEmail(body.email);
    const valid=await passwordMatches(body.password,owner?.password_hash||`${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if(!owner||!valid)throw new HttpError(401,'invalid_credentials','Invalid email or password');await session(res,owner);
  });
  app.post('/auth/logout',auth,async(req,res)=>{await store.pool.query('DELETE FROM sessions WHERE token_hash=$1',[req.sessionHash]);res.status(204).end();});
  const api=express.Router();api.use(auth);
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:0,parts:1}});
  api.post('/images',upload.single('image'),async(req,res)=>{
    if(!req.file)throw new HttpError(400,'image_required','Multipart field image is required');
    const image=await ingest(store,config,req.owner,req.file.buffer);
    res.status(image.replayed?200:202).json({id:image.id,status:image.status,replayed:image.replayed});
  });
  api.get('/images',async(req,res)=>{const p=parse(pageSchema,req.query);res.json({items:await store.rows('SELECT id,status,metadata,flag_reason,created_at FROM images WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[req.owner,p.limit,p.offset])});});
  api.get('/images/:id',async(req,res)=>{const image=await store.image(req.owner,uuid(req.params.id));delete image.filename;delete image.content_hash;delete image.owner_id;res.json(image);});
  api.get('/images/:id/file',async(req,res)=>{const image=await store.image(req.owner,uuid(req.params.id));res.type('jpeg').sendFile(path.join(config.dataDir,'images',image.filename));});
  api.post('/batches',json,async(req,res)=>{
    const body=parse(z.object({imageIds:z.array(z.uuid()).min(1).max(100)}).strict(),req.body);
    // Validate the entire batch before enqueuing anything.
    for(const id of body.imageIds)await store.image(req.owner,id);
    for(const id of new Set(body.imageIds))await store.enqueue(store.pool,req.owner,'image',id,pipelineVersion(config));
    res.status(202).json({queued:new Set(body.imageIds).size,idempotent:true});
  });
  api.post('/posts',json,async(req,res)=>{
    const body=parse(postSchema,req.body);const key=parse(z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),req.get('Idempotency-Key'));
    const post=await store.addPost(req.owner,body,key,digest(JSON.stringify(body)),pipelineVersion(config));
    res.status(post.replayed?200:202).json({id:post.id,status:post.status,replayed:post.replayed,intent:intent(`${post.title} ${post.content}`)});
  });
  api.get('/posts',async(req,res)=>{const p=parse(pageSchema,req.query);res.json({items:await store.rows('SELECT id,title,content,status,created_at FROM posts WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[req.owner,p.limit,p.offset])});});
  api.get('/posts/:id',async(req,res)=>{const p=await store.post(req.owner,uuid(req.params.id));res.json({id:p.id,title:p.title,content:p.content,status:p.status});});
  async function suggestions(owner,id){const data=await store.matchingData(owner,id,config.embeddingModel);return rank(data.post,data.images,config);}
  const result=(ranked)=>({status:ranked.some(r=>r.accepted)?'matched':'no_confident_match',reasons:ranked.some(r=>r.accepted)?[]:['No image clears all subject, confidence and similarity checks.'],candidates:ranked});
  api.get('/posts/:id/images',async(req,res)=>res.json(result(await suggestions(req.owner,uuid(req.params.id)))));
  api.post('/posts/:id/matches',json,async(req,res)=>{
    parse(z.object({}).strict(),req.body);const id=uuid(req.params.id),ranked=await suggestions(req.owner,id);
    const saved=await store.snapshot(req.owner,id,ranked,{similarity:config.similarity,confidence:config.confidence,model:config.embeddingModel});
    res.status(201).json({...result(saved.suggestions),runId:saved.runId});
  });
  api.get('/posts/:id/images/:imageId/check',async(req,res)=>{
    const image=await store.image(req.owner,uuid(req.params.imageId));
    const {post}=await store.matchingData(req.owner,uuid(req.params.id),config.embeddingModel);
    const iv=await store.one("SELECT embedding FROM vectors WHERE owner_id=$1 AND target_type='image' AND target_id=$2 AND model=$3",[req.owner,image.id,config.embeddingModel]);
    const similarity=iv?cosine(post.vector,iv.embedding):-1;
    res.json({imageId:image.id,similarity,...guard(intent(`${post.title} ${post.content}`),image.metadata,similarity,config,image.status)});
  });
  api.get('/suggestions/:id',async(req,res)=>{
    const row=await store.one('SELECT s.*,r.decision,r.note FROM suggestions s LEFT JOIN reviews r ON r.suggestion_id=s.id AND r.owner_id=s.owner_id WHERE s.id=$1 AND s.owner_id=$2',[uuid(req.params.id),req.owner]);if(!row)throw notFound();res.json(row);
  });
  api.put('/suggestions/:id/review',json,async(req,res)=>res.json(await store.review(req.owner,uuid(req.params.id),parse(reviewSchema,req.body))));
  api.get('/jobs',async(req,res)=>{
    const p=parse(pageSchema,req.query);
    res.json({items:await store.rows('SELECT id,target_type,target_id,status,attempts,last_error,created_at FROM jobs WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[req.owner,p.limit,p.offset]),counts:await store.rows('SELECT status,count(*)::int AS count FROM jobs WHERE owner_id=$1 GROUP BY status',[req.owner])});
  });
  api.post('/jobs/:id/retry',json,async(req,res)=>{
    parse(z.object({}).strict(),req.body);
    const job=await store.one("UPDATE jobs SET status='pending',attempts=0,next_at=now(),last_error=NULL WHERE id=$1 AND owner_id=$2 AND status='failed' RETURNING id",[uuid(req.params.id),req.owner]);
    if(!job)throw new HttpError(404,'failed_job_not_found','No failed job found');res.status(202).json(job);
  });
  api.get('/costs',async(req,res)=>{
    const p=parse(pageSchema,req.query);
    res.json({summary:await store.one('SELECT count(*)::int AS calls,COALESCE(sum(cost_usd),0)::float AS usd,COALESCE(sum(input_tokens),0)::int AS input_tokens,COALESCE(sum(output_tokens),0)::int AS output_tokens FROM ai_calls WHERE owner_id=$1',[req.owner]),items:await store.rows('SELECT id,job_id,target_id,kind,model,status,input_tokens,output_tokens,duration_ms,cost_usd,error_code,created_at FROM ai_calls WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[req.owner,p.limit,p.offset]),budget:{dailyCalls:config.dailyCalls,dailyUsd:config.dailyUsd,fees:'Local inference has no API fee; hardware costs are excluded.'}});
  });
  app.use('/api',api);
  app.use((req,res,next)=>{res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");next();},express.static(path.join(root,'public')));
  app.use((req,res)=>res.status(404).json({error:{code:'not_found',message:'Resource not found'}}));
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    if(error instanceof HttpError)return res.status(error.status).json({error:{code:error.code,message:error.message}});
    if(error.type==='entity.too.large'||error.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:{code:'too_large',message:'Request exceeds the size limit'}});
    if(error.type==='entity.parse.failed'||error instanceof multer.MulterError)return res.status(400).json({error:{code:'invalid_request',message:'Malformed request'}});
    if(error.status>=400&&error.status<500)return res.status(error.status).json({error:{code:'invalid_request',message:'Unsupported request body or encoding'}});
    logger.error('{"event":"request_failed"}');res.status(500).json({error:{code:'internal_error',message:'Unexpected server error'}});
  });
  return app;
}
