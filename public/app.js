let token=null,offset=0,images=[],posts=[],urls=[];
const imageUrls=new Map();
const $=s=>document.querySelector(s),make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const message=text=>{$('#message').textContent=text;};
async function api(route,options={}){
  const r=await fetch(route,{...options,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.body&&!(options.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...options.headers}});
  if(r.status===204)return null;const data=await r.json();if(!r.ok)throw new Error(data.error?.message||'Request failed');return data;
}
async function imageElement(id,alt){const img=make('img');img.alt=alt;img.loading='lazy';if(imageUrls.has(id)){img.src=imageUrls.get(id);return img;}const r=await fetch(`/api/images/${id}/file`,{headers:{Authorization:`Bearer ${token}`}});if(r.ok){const url=URL.createObjectURL(await r.blob());urls.push(url);imageUrls.set(id,url);img.src=url;}return img;}
async function auth(register=false){const form=$('#auth-form');if(!form.reportValidity())return;try{const data=await api(`/auth/${register?'register':'login'}`,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});token=data.token;$('#identity').textContent=data.owner.email;form.reset();$('#auth').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;message('');await refresh();}catch(e){message(e.message);}}
$('#auth-form').onsubmit=e=>{e.preventDefault();auth();};$('#register').onclick=()=>auth(true);
$('#logout').onclick=async()=>{try{await api('/auth/logout',{method:'POST'});token=null;location.reload();}catch(e){message(e.message);}};
function badge(text,cls=text){return make('span',text,'badge '+cls);}
async function refresh(){
  const chosen=$('#post-select').value;
  const [library,articles,jobs,costs]=await Promise.all([api(`/api/images?limit=12&offset=${offset}`),api('/api/posts?limit=100'),api('/api/jobs?limit=20'),api('/api/costs?limit=12')]);
  images=library.items;posts=articles.items;
  const counts=Object.fromEntries(jobs.counts.map(c=>[c.status,c.count]));
  // Fetch the small library's status totals separately from pagination.
  const all=await api('/api/images?limit=100');
  $('#image-total').textContent=all.items.length+(all.items.length===100?'+':'');$('#ready-total').textContent=all.items.filter(i=>i.status==='ready').length;$('#flagged-total').textContent=all.items.filter(i=>['flagged','failed'].includes(i.status)).length;
  $('#cost-total').textContent=`$${Number(costs.summary.usd).toFixed(2)}`;$('#call-total').textContent=`${costs.summary.calls} recorded calls`;
  $('#image-grid').replaceChildren();
  for(const image of images){const card=make('article',null,'image-card');card.append(await imageElement(image.id,image.metadata?.caption||'Uploaded image awaiting understanding'));const meta=make('div',null,'image-meta');meta.append(make('h3',image.metadata?.subject||'Understanding image…'),badge(image.status));if(image.metadata)meta.append(make('span',`${Math.round(image.metadata.confidence*100)}% model confidence`,'confidence'));meta.append(make('p',image.metadata?.caption||image.flag_reason||'Queued for the background worker.'));card.append(meta);$('#image-grid').append(card);}
  if(!images.length)$('#image-grid').append(make('p','Your library starts with one image. Upload a JPEG, PNG or WebP.','empty'));
  $('#page-label').textContent=`Page ${offset/12+1}`;$('#previous').disabled=offset===0;$('#next').disabled=images.length<12;
  $('#post-select').replaceChildren(make('option','Choose an article'));$('#post-select').firstChild.value='';
  for(const post of posts){const option=make('option',`${post.title}${post.status!=='ready'?' · '+post.status:''}`);option.value=post.id;$('#post-select').append(option);}$('#post-select').value=chosen;
  $('#progress').textContent=`${counts.done||0} done · ${counts.processing||0} processing · ${counts.pending||0} queued · ${counts.failed||0} failed`;
  $('#jobs').replaceChildren();for(const job of jobs.items){const row=make('tr');row.append(make('td',job.target_type==='image'?'Image understanding':'Article embedding'));const status=make('td');status.append(badge(job.status));row.append(status,make('td',job.attempts),make('td',job.last_error||'—'));const action=make('td');if(job.status==='failed'){const retry=make('button','Retry','secondary');retry.onclick=async()=>{try{await api(`/api/jobs/${job.id}/retry`,{method:'POST',body:'{}'});await refresh();}catch(e){message(e.message);}};action.append(retry);}row.append(action);$('#jobs').append(row);}
  $('#costs').replaceChildren();for(const call of costs.items){const row=make('div',null,'cost-line');row.append(make('span',`${call.kind} / ${call.model}`),make('span',`${call.status} · ${call.input_tokens??'?'} in / ${call.output_tokens??'?'} out · $${Number(call.cost_usd).toFixed(6)}`));$('#costs').append(row);}
}
$('#refresh').onclick=()=>refresh().catch(e=>message(e.message));
$('#previous').onclick=()=>{offset=Math.max(0,offset-12);refresh().catch(e=>message(e.message));};$('#next').onclick=()=>{offset+=12;refresh().catch(e=>message(e.message));};
$('#upload-form').onsubmit=async e=>{e.preventDefault();try{const data=await api('/api/images',{method:'POST',body:new FormData(e.currentTarget)});message(data.replayed?'This image is already in your library.':'Image uploaded and queued for understanding.');e.target.reset();offset=0;await refresh();}catch(error){message(error.message);}};
$('#post-form').onsubmit=async e=>{e.preventDefault();try{const result=await api('/api/posts',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});e.target.reset();message('Article queued for embedding. Refresh after processing completes.');await refresh();$('#post-select').value=result.id;}catch(error){message(error.message);}};
$('#match').onclick=async()=>{const id=$('#post-select').value;if(!id)return message('Choose an article first.');try{
  const data=await api(`/api/posts/${id}/matches`,{method:'POST',body:'{}'});$('#match-state').textContent=data.status==='matched'?'MATCHES FOUND':'NO CONFIDENT MATCH';$('#suggestions').replaceChildren();
  if(data.status!=='matched')$('#suggestions').append(make('p',data.reasons.join(' '),'empty'));
  for(const candidate of data.candidates.slice(0,8)){
    const row=make('article',null,'suggestion');row.append(await imageElement(candidate.imageId,'Candidate image'));const detail=make('div');detail.append(badge(candidate.accepted?'accepted':'rejected'),make('h3',`Similarity ${candidate.similarity.toFixed(3)} · confidence ${Math.round(candidate.confidence*100)}%`),make('p',candidate.reasons.join(' ')));
    for(const decision of ['approve','reject']){const button=make('button',decision==='approve'?'Approve pairing':'Reject pairing',decision==='reject'?'secondary':'');button.disabled=decision==='approve'&&!candidate.accepted;button.onclick=async()=>{try{await api(`/api/suggestions/${candidate.suggestionId}/review`,{method:'PUT',body:JSON.stringify({decision,note:'Reviewed in Lens workspace'})});message(`Pairing ${decision==='approve'?'approved':'rejected'}.`);}catch(error){message(error.message);}};detail.append(button);}row.append(detail);$('#suggestions').append(row);
  }
}catch(error){message(error.message);}};
window.addEventListener('beforeunload',()=>urls.forEach(url=>URL.revokeObjectURL(url)));
