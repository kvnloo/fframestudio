#!/usr/bin/env node
import fs from 'node:fs/promises';import path from 'node:path';import {fromV0} from '../web/src/doc/project.js';
try{
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node tools/migrate-project.mjs INPUT.json NEW_OUTPUT.json');
 const source=await fs.realpath(input),dest=path.resolve(output);if(source===dest)throw Error('Refusing in-place migration: choose a new output copy');
 const doc=fromV0(JSON.parse(await fs.readFile(source,'utf8')));await fs.writeFile(dest,JSON.stringify(doc,null,2)+'\n',{flag:'wx'});
 console.log(`Migrated ${doc.id}: ${doc.videos.reduce((n,v)=>n+v.clips.length,0)} clips → ${dest}`);
}catch(e){console.error(e.message);process.exitCode=1;}
