import path from 'node:path';
import { modelCall,ollamaProvider } from './provider.js';
import { pipelineVersion } from './ingest.js';
export function worker(store,config,{provider=ollamaProvider(config),logger=console}={}) {
  let running=false,stopped=false,timer;
  async function tick() {
    if(running||stopped) return false;
    running=true;
    try {
      const job=await store.claim(config.modelTimeoutMs*3+30000,pipelineVersion(config));
      if(!job) return false;
      try {
        if(job.attempts>config.maxAttempts) throw new Error('attempts_exhausted');
        let text,flagged=false;
        if(job.target_type==='image') {
          const image=await store.image(job.owner_id,job.target_id);
          let metadata=image.metadata_model===config.visionModel?image.metadata:null;
          if(!metadata) {
            metadata=await modelCall(store,job,'vision',config.visionModel,config,()=>provider.vision(path.join(config.dataDir,'images',image.filename)));
            flagged=metadata.confidence<config.confidence||metadata.subject==='unknown';
            await store.saveMetadata(job,metadata,flagged,config.visionModel);
          }
          flagged=metadata.confidence<config.confidence||metadata.subject==='unknown';
          text=`${metadata.subject}. ${metadata.caption} ${metadata.attributes.join(', ')}`;
        } else { const post=await store.post(job.owner_id,job.target_id); text=`${post.title}. ${post.content}`; }
        const embedding=await modelCall(store,job,'embedding',config.embeddingModel,config,()=>provider.embed(text));
        await store.finish(job,embedding,config.embeddingModel,flagged);
      } catch(error) {
        const code=error.code==='budget_exceeded'?'budget_exceeded':error.name==='ZodError'?'invalid_model_output':'processing_failed';
        const terminal=await store.fail(job,code,config.maxAttempts,config.retryMs*2**Math.min(job.attempts-1,5));
        logger[terminal?'error':'warn'](JSON.stringify({event:terminal?'job_dead_letter':'job_retry',jobId:job.id,code,attempt:job.attempts}));
      }
      return true;
    } finally {running=false;}
  }
  return {tick,start(){timer=setInterval(()=>tick().catch(()=>logger.error('{"event":"worker_error"}')),config.workerPollMs);timer.unref();},async stop(){stopped=true;clearInterval(timer);while(running)await new Promise(r=>setTimeout(r,100));}};
}
