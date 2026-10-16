import { AgentResource } from '../../src/resources/agent';
// This fixture exercises browser cleanup only; never access the real Mobbin account.
const originalJSON = AgentResource.prototype.toJSON;
AgentResource.prototype.toJSON = function() {
 const data = originalJSON.call(this);
 return {...data, profile: {...data.profile, tools: data.profile.tools.filter(t => t !== 'mobbin')}};
};
// Exercise actual command shutdown without network or paid calls.
import { TokenUsageResource } from '../../src/resources/token_usage';
import Firecrawl from 'firecrawl';
import { AnthropicLLM } from '../../src/models/anthropic';
import { ok } from '../../src/lib/error';
import { appendFileSync } from 'node:fs';
let calls=0;
let costChecks=0;
if(process.env.STOP_MODE==='budget') TokenUsageResource.experimentCost=async()=>++costChecks>=3?100:0;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4xoAAAAASUVORK5CYII=';
Firecrawl.prototype.browser=async()=>({success:true,id:'cli-session'});
Firecrawl.prototype.browserExecute=async()=>{
 if(process.env.STOP_MODE==='signal')setTimeout(()=>process.kill(process.pid,'SIGINT'),30);
 return {success:true,stdout:JSON.stringify({url:'https://example.com',text:'Page',image:png})};
};
Firecrawl.prototype.deleteBrowser=async()=>{appendFileSync(process.env.CLOSE_LOG!,'closed\n');return {success:true};};
AnthropicLLM.prototype.tokens=async()=>ok(10);
AnthropicLLM.prototype.run=async()=>{
 if(calls++>0){
  if(process.env.STOP_MODE==='signal')return await new Promise(()=>{setInterval(()=>{},1000);});
  if(process.env.STOP_MODE==='budget')return ok({message:{role:'agent',content:[{type:'text',text:'Continuing',provider:null}]}});
  throw new Error('Synthetic model failure');
 }
 return ok({message:{role:'agent',content:[{type:'tool_use',id:'cli-open',name:'web-open',input:{url:'https://example.com'},provider:null}]}});
};
import('../../src/dsgnrd');
