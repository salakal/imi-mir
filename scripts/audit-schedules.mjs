import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseSchedule } from '../lib/pdf-data.ts';
// Default: enumerate the app's current official Yandex.Disk source paths and
// download the actual published PDFs. Offline: --sources JSON --pdf-dir DIR.
const offline=process.argv.includes('--sources');
const option=name=>process.argv[process.argv.indexOf(name)+1];
const fetchJSON=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);return response.json()};
const sources=offline?JSON.parse(readFileSync(option('--sources'))).sources:
  (await fetchJSON('https://imi-mir.vercel.app/api/schedule-sources')).sources;
const pdfDir=offline?option('--pdf-dir'):join(tmpdir(),'imi-schedule-audit');
if(!pdfDir)throw new Error('Offline audit requires --pdf-dir');
mkdirSync(pdfDir,{recursive:true});
async function officialPdf(path){
  const api=new URL('https://cloud-api.yandex.net/v1/disk/public/resources/download');
  api.searchParams.set('public_key','https://disk.yandex.ru/d/KTpb1wS1l0-amA');api.searchParams.set('path',path);
  let href;
  try{href=(await fetchJSON(api)).href}
  catch(error){console.warn(`Yandex download metadata unavailable; using existing source proxy: ${error.message}`);
    const proxy=new URL('https://imi-mir.vercel.app/api/pdf');proxy.searchParams.set('path',path);href=proxy.href}
  const response=await fetch(href,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`PDF ${path}: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.subarray(0,4).toString()!=='%PDF')throw new Error(`${path}: response is not PDF`);
  return bytes;
}
// Temporary baseline diagnostic: retain every current source even if parsing fails.
if (!offline) for (const [i, source] of sources.entries()) {
  const file = join(pdfDir,`${String(i).padStart(2,'0')}.pdf`);
  if (!existsSync(file)) writeFileSync(file, await officialPdf(source.path));
}
let checked=0, missing=0, rooms=0, unexpected=0, merged=0, sourceMissingRoom=0, unowned=0, subjects=0, formats=0;
const cases=[];
const uiExpectations=[];
const nrm=s=>s.toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[.\s]/g,'');
for(const [i,s] of sources.entries()){
 const expected=new Map();
 const file=join(pdfDir,`${String(i).padStart(2,'0')}.pdf`);
 if(!existsSync(file)&&!offline)writeFileSync(file,await officialPdf(s.path));
 const b=readFileSync(file);
 if(b.subarray(0,4).toString()!=='%PDF')throw new Error(`${file}: not a PDF`);
 const page=await(await getDocument({data:new Uint8Array(b)}).promise).getPage(1),H=page.view[3],W=page.view[2];
 const items=(await page.getTextContent()).items.filter(t=>t.str?.trim()).map(t=>({str:t.str.trim(),x:t.transform[4],y:H-t.transform[5],width:t.width}));
 const headers=items.filter(t=>t.y<82&&/^(?:К-[А-ЯЁ]+|БД|ЗУ|Юр)-\d/i.test(t.str)).sort((a,b)=>a.x-b.x);
 const headerGroups=v=>v.toUpperCase().split(/\s*,\s*/).map((p,k,a)=>k&&/^\d/.test(p)?a[0].slice(0,a[0].lastIndexOf('-')+1)+p:p);
 const named=headers.map(t=>({...t,names:headerGroups(t.str),cx:t.x+t.width/2}));
 for(const h of named)for(const name of h.names)if(!s.groups.some(g=>g.toUpperCase()===name))
   throw new Error(`${s.path}: source header ${name} is absent from the published group mapping`);
 const ppmPath=`/tmp/source-${i}`;execFileSync('pdftoppm',['-f','1','-singlefile','-r','144',file,ppmPath]);
 const ppm=readFileSync(ppmPath+'.ppm'),m=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.toString('ascii',0,64)),pw=+m[1],ph=+m[2],offset=Buffer.byteLength(m[0]);
 const rgb=(x,y)=>{let px=Math.max(0,Math.min(pw-1,Math.round(x*2))),py=Math.max(0,Math.min(ph-1,Math.round(y*2))),o=offset+(py*pw+px)*3;return [ppm[o],ppm[o+1],ppm[o+2]]};
 const yellow=(x,y)=>{let [r,g,b]=rgb(x,y);return r>210&&g>205&&b<140&&r>b*1.65};
 const separators=[];for(let y=headers[0].y+12;y<H-15;y+=.5)if([3,6,10].some(dx=>yellow(named[0].cx+dx,y))&&(!separators.length||y-separators.at(-1)>15))separators.push(y);
 if(separators.length!==5)console.log('SEPARATORS',i,separators);
 const anchors=Array.from({length:6},(_,day)=>items.filter(t=>t.x>=15&&t.x<Math.min(...headers.map(h=>h.x))-12&&t.y>([headers[0].y+6,...separators][day])&&t.y<([...separators,H-10][day])&&/^(?:8\.15|9\.00|9\.55|11\.50|13\.30|15\.20|17\.00)/.test(t.str)).sort((a,b)=>a.y-b.y));
 const parsed={};for(const group of s.groups)parsed[group]=await parseSchedule(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),group,rgb);
 for(const group of s.groups)uiExpectations.push({group,institution:s.institution,days:parsed[group].map(d=>d.pairs.length)});
 const sourceMarkers=items.filter(t=>(/^преп\s*\.?/i.test(t.str)||/^ауд\s+[А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\./i.test(t.str))&&t.y>headers[0].y+4);
 for(const marker of sourceMarkers){
   const day=separators.filter(y=>y<marker.y).length;
   if(day>5)continue;
   const slot=anchors[day].filter(a=>a.y<marker.y+1).at(-1)??anchors[day][0], sm=slot?.str.match(/^(\d{1,2})\.(\d{2})/), time=sm?`${sm[1].padStart(2,'0')}:${sm[2]}`:undefined;
   const sx=marker.x+marker.width/2;
   const near=items.filter(t=>t.y<marker.y&&t.y>marker.y-9&&Math.abs(t.x+t.width/2-sx)<65&&!/^преп/i.test(t.str)).sort((a,b)=>b.y-a.y||Math.abs(a.x+a.width/2-sx)-Math.abs(b.x+b.width/2-sx));
   const hint=near.find(t=>/^\d{1,2}\.\d{2}\s+[А-ЯЁ]/i.test(t.str))?.str.match(/^(\d{1,2})\.(\d{2})/);
   const expectedTime=hint?`${hint[1].padStart(2,'0')}:${hint[2]}`:time;
   const roomItem=items.filter(t=>t.y>marker.y+1&&t.y<marker.y+10&&Math.abs(t.x+t.width/2-sx)<45&&/(?:ауд|каб)/i.test(t.str)).sort((a,b)=>Math.abs(a.y-marker.y)-Math.abs(b.y-marker.y))[0];
   const room=roomItem?.str.match(/(?:ауд|каб)\.?\s*(\d+[а-яёa-z]?)/i)?.[1];
   const remoteSource=items.some(t=>Math.abs(t.x+t.width/2-sx)<60&&t.y>marker.y-5&&t.y<marker.y+12&&/дистанционно|дистант|онлайн/i.test(t.str));
   if(roomItem&&!room)sourceMissingRoom++;
   // Detect the continuous table strokes surrounding the marker. Character
   // stems cannot survive most of the 12-point vertical sample interval.
   const lines=[];for(let x=15;x<W-7;x+=.5){let run=0,longest=0;for(let y=marker.y-7;y<=marker.y+7;y++){const z=rgb(x,y)[0];let contrast=z<170&&rgb(x-2,y)[0]-z>20&&rgb(x+2,y)[0]-z>20;run=contrast?run+1:0;longest=Math.max(longest,run)}if(longest>=9&&(!lines.length||x-lines.at(-1)>2))lines.push(x)}
   let left=[...lines].reverse().find(x=>x<sx)??named[0].cx-(named[1].cx-named[0].cx)/2;
   let right=lines.find(x=>x>sx)??named.at(-1).cx+(named.at(-1).cx-named.at(-2).cx)/2;
   const simultaneous=sourceMarkers.filter(t=>Math.abs(t.y-marker.y)<2&&t!==marker&&t.x+t.width/2>left&&t.x+t.width/2<right);
   for(const other of simultaneous){let ox=other.x+other.width/2;if(Math.abs(ox-sx)<10)continue;let mid=(ox+sx)/2;if(ox<sx)left=Math.max(left,mid);else right=Math.min(right,mid)}
   const owners=named.filter((h,k)=>{
     const l=k? (named[k-1].cx+h.cx)/2:h.cx-(named[k+1].cx-h.cx)/2;
     const r=k<named.length-1?(h.cx+named[k+1].cx)/2:h.cx+(h.cx-named[k-1].cx)/2;
     return Math.max(0,Math.min(right,r)-Math.max(left,l))>(r-l)*.28;
   });
   if(!owners.length){unowned++;if(cases.length<35)cases.push(['UNOWNED',i,day,expectedTime,marker.str,left,right,sx])}
   if(owners.length>1)merged++;
   const subjectItems=items.filter(t=>t.y<marker.y-1&&t.y>marker.y-17&&
      t.x+t.width/2>left+1&&t.x+t.width/2<right-1&&
      Math.abs(t.x+t.width/2-sx)<Math.max(65,(right-left)*.65)&&
      !/^(?:преп|ауд|каб|спорт\s*зал|стадион|подгруппа|\d{1,2}\.\d{2}\s*[-–])/i.test(t.str)&&
      !/^(?:К-|БД-|ЗУ-|Юр-)/i.test(t.str)&&!t.str.includes('НЕДЕЛЯ')&&
      !/^(?:ПОНЕДЕЛЬНИК|ВТОРНИК|СРЕДА|ЧЕТВЕРГ|ПЯТНИЦА|СУББОТА)$/i.test(t.str))
     .filter(t=>!sourceMarkers.some(other=>other!==marker&&Math.abs(other.y-marker.y)<3&&
       Math.abs(other.x+other.width/2-(t.x+t.width/2))<Math.abs(sx-(t.x+t.width/2))))
     .sort((a,b)=>a.y-b.y||a.x-b.x);
   const subjectSource=subjectItems.map(t=>t.str).join(' ').replace(/^\d{1,2}\.\d{2}\s+/, '').trim();
   for(const owner of owners)for(const name of owner.names){
     const group=s.groups.find(g=>nrm(g)===nrm(name));
     if(!group||!parsed[group])continue;
     checked++;
     const teacher=nrm(marker.str.replace(/^(?:(?:преп|ауд)\s*\.?\s*)+/i,''));
     const key=`${group}|${day}|${expectedTime}|${teacher}`;
     expected.set(key,(expected.get(key)??0)+1);
     const candidates=parsed[group][day]?.pairs.filter(p=>p.time.startsWith(expectedTime??'!')&&nrm(p.teacher)===teacher);
     if(!candidates?.length){missing++;if(cases.length<35)cases.push(['MISSING',i,group,day,expectedTime,marker.str,room,left,right,sx]);continue}
     if(room&&!candidates.some(p=>nrm(p.room).split(',').includes(nrm(room)))){rooms++;if(cases.length<35)cases.push(['ROOM',i,group,day,expectedTime,marker.str,room,candidates.map(p=>p.room)])}
     if(subjectSource&&candidates.length&&!candidates.some(p=>nrm(p.subject)===nrm(subjectSource))){
       subjects++;if(cases.length<35)cases.push(['SUBJECT',i,group,day,expectedTime,subjectSource,candidates.map(p=>p.subject)]);
     }
     if(candidates.length&&!candidates.some(p=>p.remote===remoteSource)){
       formats++;if(cases.length<35)cases.push(['FORMAT',i,group,day,expectedTime,remoteSource,candidates.map(p=>p.remote)]);
     }
   }
 }
 const noTeacherRooms=items.filter(t=>/^(?:аудитория|ауд\.?|кабинет|каб\.?)\s*\d/i.test(t.str)&&
   !sourceMarkers.some(m=>m.y<t.y&&m.y>t.y-12&&Math.abs(m.x+m.width/2-(t.x+t.width/2))<55));
 for(const roomItem of noTeacherRooms){
   const x=roomItem.x+roomItem.width/2,y=roomItem.y;
   const title=items.filter(t=>t.y<y-2&&t.y>y-19&&Math.abs(t.x+t.width/2-x)<70&&
     !/^(?:ауд|каб|преп|спорт\s*зал|\d{1,2}\.\d{2}\s*[-–])/i.test(t.str))
     .sort((a,b)=>a.y-b.y||a.x-b.x).map(t=>t.str).join(' ');
   if(!title||!/проверочная|занятие|лекция|консультация/i.test(title))continue;
   const day=separators.filter(z=>z<y).length;
   if(day>5)continue;
   const timeMatch=title.match(/(\d{1,2})\.(\d{2})/);
   const anchor=anchors[day].filter(a=>a.y<y+1).at(-1)??anchors[day][0];
   const fallback=anchor?.str.match(/^(\d{1,2})\.(\d{2})/);
   const time=timeMatch?`${timeMatch[1].padStart(2,'0')}:${timeMatch[2]}`:fallback?`${fallback[1].padStart(2,'0')}:${fallback[2]}`:undefined;
   const room=roomItem.str.match(/\d+[а-яёa-z]?/i)?.[0];
   const lines=[];for(let px=15;px<W-7;px+=.5){let run=0,longest=0;for(let py=y-10;py<=y+4;py++){const z=rgb(px,py)[0];let ink=z<170&&rgb(px-2,py)[0]-z>20&&rgb(px+2,py)[0]-z>20;run=ink?run+1:0;longest=Math.max(longest,run)}if(longest>=9&&(!lines.length||px-lines.at(-1)>2))lines.push(px)}
   const left=[...lines].reverse().find(px=>px<x)??named[0].cx-(named[1].cx-named[0].cx)/2;
   const right=lines.find(px=>px>x)??named.at(-1).cx+(named.at(-1).cx-named.at(-2).cx)/2;
   const owners=named.filter((h,k)=>{const l=k?(named[k-1].cx+h.cx)/2:h.cx-(named[k+1].cx-h.cx)/2;
     const r=k<named.length-1?(h.cx+named[k+1].cx)/2:h.cx+(h.cx-named[k-1].cx)/2;
     return Math.max(0,Math.min(right,r)-Math.max(left,l))>(r-l)*.28});
   for(const owner of owners)for(const name of owner.names){
     const group=s.groups.find(g=>nrm(g)===nrm(name));if(!group)continue;
     const key=`${group}|${day}|${time}|${nrm('Не указан в PDF')}`;
     expected.set(key,(expected.get(key)??0)+1);checked++;
     const candidates=parsed[group][day]?.pairs.filter(p=>p.time.startsWith(time??'!')&&p.teacher==='Не указан в PDF');
     if(!candidates?.length){missing++;if(cases.length<35)cases.push(['NO_TEACHER_MISSING',i,group,day,time,title,room]);continue}
     if(room&&!candidates.some(p=>nrm(p.room)===nrm(room))){rooms++;if(cases.length<35)cases.push(['NO_TEACHER_ROOM',i,group,day,time,room,candidates.map(p=>p.room)])}
   }
 }
 let fileUnexpected=0;
 const actual=new Map();
 for(const group of s.groups)for(const [day,d] of parsed[group].entries())for(const p of d.pairs){
   const key=`${group}|${day}|${p.time.split('–')[0]}|${nrm(p.teacher)}`;
   actual.set(key,(actual.get(key)??0)+1);
   if(!expected.has(key)){
     fileUnexpected++;if(cases.length<35)cases.push(['UNEXPECTED',i,group,day,p.time,p.subject,p.teacher,p.room]);
   }
 }
 for(const [key,count] of expected)if(actual.get(key)!==count){
   fileUnexpected++;if(cases.length<35)cases.push(['COUNT',i,key,count,actual.get(key)??0]);
 }
 unexpected+=fileUnexpected;
 console.log('FILE',i,'markers',sourceMarkers.length,'groups',s.groups.length,'unexpected',fileUnexpected);
}
const summary={pdfFiles:sources.length,groups:sources.reduce((n,s)=>n+s.groups.length,0),days:sources.reduce((n,s)=>n+s.groups.length*6,0),lessons:checked,
  missing,roomErrors:rooms,subjectErrors:subjects,formatErrors:formats,unexpectedOrDuplicates:unexpected,
  mergedCommonSourceCells:merged,sourceRoomUnspecified:sourceMissingRoom,unownedSourceCells:unowned,cases};
console.log(JSON.stringify(summary,null,2));
if(process.env.IMI_AUDIT_EXPECTATIONS)writeFileSync(process.env.IMI_AUDIT_EXPECTATIONS,JSON.stringify(uiExpectations));
if(missing||rooms||subjects||formats||unexpected||unowned)process.exitCode=1;
