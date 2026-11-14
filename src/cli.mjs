#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {inspectTrace,toMarkdown} from './inspect.mjs';
const [file,format='json']=process.argv.slice(2);
if(!file||!['json','markdown'].includes(format)){
 console.error('Usage: node src/cli.mjs trace.json [json|markdown]');
 process.exitCode=1;
}else try{
 const content=await readFile(file,'utf8');
 if(content.length>1048576)throw Error('Input exceeds 1 MiB.');
 const report=inspectTrace(content);
 console.log(format==='markdown'?toMarkdown(report):JSON.stringify(report,null,2));
}catch(e){console.error('Input error: '+e.message);process.exitCode=1;}
