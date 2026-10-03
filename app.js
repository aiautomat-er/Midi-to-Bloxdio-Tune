const $ = (id) => document.getElementById(id);
const fileInput = $('midi-file'), dropzone = $('dropzone'), fileCard = $('file-card');
const controls = ['track-select','instrument-select','timing-select'].map($);
let midi = null, parsed = null;

function readVar(bytes, state) { let value = 0, byte; do { byte = bytes[state.i++]; value = (value << 7) | (byte & 0x7f); } while (byte & 0x80); return value; }
function text(bytes, start, length) { return new TextDecoder().decode(bytes.slice(start, start + length)); }
function parseMidi(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer); let i = 0;
  const chunk = () => { const id = text(bytes,i,4); i += 4; const len = view.getUint32(i); i += 4; return {id, end:i + len}; };
  const head = chunk(); if (head.id !== 'MThd') throw new Error('This does not look like a standard MIDI file.');
  const format = view.getUint16(i), tracksCount = view.getUint16(i + 2), division = view.getUint16(i + 4); i = head.end;
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported.');
  const tracks = [], tempos = [{tick:0, microseconds:500000}];
  for (let t = 0; t < tracksCount; t++) { const c = chunk(); if (c.id !== 'MTrk') throw new Error('Invalid MIDI track.'); let tick = 0, running = 0, name = `Track ${t + 1}`, open = new Map(), notes = [];
    while (i < c.end) { tick += readVar(bytes,{get i(){return i},set i(v){i=v}}); let status = bytes[i++]; if (status < 0x80) { i--; status = running; } else if (status < 0xf0) running = status;
      if (status === 0xff) { const type=bytes[i++], len=readVar(bytes,{get i(){return i},set i(v){i=v}}); if (type===0x51 && len===3) tempos.push({tick,microseconds:(bytes[i]<<16)|(bytes[i+1]<<8)|bytes[i+2]}); if ((type===0x03 || type===0x04) && len) name=text(bytes,i,len); i+=len; }
      else if (status === 0xf0 || status === 0xf7) i += readVar(bytes,{get i(){return i},set i(v){i=v}});
      else { const type=status>>4, channel=status&15, a=bytes[i++], b=(type===0xc || type===0xd) ? 0 : bytes[i++]; const key=`${channel}:${a}`;
        if (type===9 && b) { if (!open.has(key)) open.set(key,[]); open.get(key).push({tick,pitch:a,velocity:b,channel}); }
        else if (type===8 || (type===9 && !b)) { const item=open.get(key)?.shift(); if (item) notes.push({...item,endTick:tick}); }
      }
    } i=c.end; notes = notes.filter(n=>n.endTick>n.tick); tracks.push({name,notes});
  }
  tempos.sort((a,b)=>a.tick-b.tick); const tickToSeconds = (tick) => { let seconds=0, previous=tempos[0]; for (const tempo of tempos) { if (tempo.tick >= tick) break; seconds += (tempo.tick-previous.tick)*previous.microseconds/division/1e6; previous=tempo; } return seconds+(tick-previous.tick)*previous.microseconds/division/1e6; };
  return {format,division,tracks,tempos,tickToSeconds};
}
function formatTime(seconds) { const m=Math.floor(seconds/60), s=(seconds%60).toFixed(1).padStart(4,'0'); return `${m}:${s}`; }
function updateFile(file) { $('file-name').textContent=file.name; $('file-detail').textContent=`${(file.size/1024).toFixed(1)} KB · ready to convert`; fileCard.hidden=false; dropzone.hidden=true; }
async function loadFile(file) { if (!file) return; try { parsed=parseMidi(await file.arrayBuffer()); midi=file; updateFile(file); const usable=parsed.tracks.filter(t=>t.notes.length); $('track-select').innerHTML=usable.map((t,index)=>`<option value="${parsed.tracks.indexOf(t)}">${t.name} · ${t.notes.length} notes</option>`).join('') || '<option>No notes found</option>'; controls.forEach(c=>c.disabled=!usable.length); $('convert').disabled=!usable.length; $('status').textContent=usable.length?'Ready to convert':'No notes found'; } catch(error) { reset(); show(error.message); } }
function reset() { midi=parsed=null; fileInput.value=''; fileCard.hidden=true; dropzone.hidden=false; controls.forEach(c=>c.disabled=true); $('convert').disabled=true; $('status').textContent='Waiting for MIDI'; }
function generate() { const track=parsed.tracks[+$('track-select').value], snapped=$('timing-select').value==='grid', instrument=$('instrument-select').value; const notes=[...track.notes].sort((a,b)=>a.tick-b.tick); const base=notes[0]?.tick||0; let last=base; const lines=[];
  for (const n of notes) { let gap=parsed.tickToSeconds(n.tick)-parsed.tickToSeconds(last); if(snapped) gap=Math.round(gap*4)/4; if(gap>.012) lines.push(`  await sleep(${Math.round(gap*1000)});`); const rate=Math.pow(2,(n.pitch-60)/12).toFixed(4); const volume=Math.max(.15,n.velocity/127).toFixed(2); lines.push(`  api.playSound(playerId, "${instrument}", ${volume}, ${rate}, { playerIdOrPos: playerId }); // ${noteName(n.pitch)}`); last=n.tick; }
  const code=`// ${midi.name} · ${track.name}\n// Paste into a Bloxd.io World Code block, then call playTune(playerId).\n\nconst sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));\n\nasync function playTune(playerId) {\n${lines.join('\n')}\n}`; $('code-output').textContent=code; const duration=parsed.tickToSeconds(Math.max(...notes.map(n=>n.endTick))); const tempo=Math.round(60000000/parsed.tempos[0].microseconds); const values=[$('stats').children[0],$('stats').children[1],$('stats').children[2]]; values[0].querySelector('strong').textContent=notes.length; values[1].querySelector('strong').textContent=formatTime(duration); values[2].querySelector('strong').textContent=`${tempo} BPM`; $('copy').disabled=false; $('status').textContent='Tune generated'; show(`${notes.length} notes converted`); }
function noteName(n) { return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][n%12]+(Math.floor(n/12)-1); }
function show(message){const toast=$('toast');toast.textContent=message;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2600)}
fileInput.addEventListener('change',e=>loadFile(e.target.files[0])); $('clear-file').addEventListener('click',reset); $('convert').addEventListener('click',generate); $('copy').addEventListener('click',async()=>{await navigator.clipboard.writeText($('code-output').textContent);show('Code copied to clipboard');});
['dragenter','dragover'].forEach(event=>dropzone.addEventListener(event,e=>{e.preventDefault();dropzone.classList.add('drag')})); ['dragleave','drop'].forEach(event=>dropzone.addEventListener(event,e=>{e.preventDefault();dropzone.classList.remove('drag')})); dropzone.addEventListener('drop',e=>loadFile(e.dataTransfer.files[0]));
