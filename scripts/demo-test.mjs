/**
 * Verifies the browser demo answers like the real server.
 *
 * The demo module imports dataset.json the way a bundler does, which Node
 * cannot do directly, so this generates a small harness first and removes it
 * afterwards.
 *
 *   node scripts/demo-test.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = join(root, 'web', 'src', 'demo');
const harness = join(demoDir, '__harness.mjs');

writeFileSync(harness, readFileSync(join(demoDir, 'api.js'), 'utf8').replace(
  "import dataset from './dataset.json';",
  "import { readFileSync as rf } from 'node:fs';\nconst dataset = JSON.parse(rf(new URL('./dataset.json', import.meta.url), 'utf8'));",
));

let m;
try {
  m = await import(`file://${harness}`);
} finally {
  process.on('exit', () => { try { unlinkSync(harness); } catch { /* already gone */ } });
}

const { demoRequest, demoPlayersCsv } = m;
const out=[];
const t=async(n,f)=>{try{out.push([(await f())?'PASS':'FAIL',n]);}catch(e){out.push(['ERR ',n+' → '+e.message]);}};

await t('login', async()=>{const r=await demoRequest('POST','/auth/login',{email:'admin@karwansc.com',password:'Karwan@2026'});return !!r.token&&r.user.role==='super_admin';});
await t('bad password rejected', async()=>{try{await demoRequest('POST','/auth/login',{email:'admin@karwansc.com',password:'wrong'});return false;}catch(e){return e.status===401;}});
await demoRequest('POST','/auth/login',{email:'admin@karwansc.com',password:'Karwan@2026'});
await t('dashboard', async()=>(await demoRequest('GET','/dashboard')).totals.athletes===46);
await t('sports+config', async()=>{const r=await demoRequest('GET','/sports');return r.sports.length===7&&r.sports[0].config.matchStats.length>0;});
await t('players list+pagination', async()=>{const r=await demoRequest('GET','/players?pageSize=10');return r.players.length===10&&r.total===46&&r.players[0].sports;});
await t('player filter by sport', async()=>{const r=await demoRequest('GET','/players?sport=1');return r.total>0&&r.total<46;});
await t('player profile', async()=>{const r=await demoRequest('GET','/players/1');return !!r.player.athlete_id&&r.summary.matches>=0&&Array.isArray(r.teamHistory);});
await t('career stats + rating', async()=>{const r=await demoRequest('GET','/players/1/stats');const c=r.careers.find(x=>x.matchesPlayed>0);return !!c&&c.career.entries.length>0&&c.rating.overall>=0;});
await t('timeline', async()=>(await demoRequest('GET','/players/1/timeline')).events.length>0);
await t('activity', async()=>Array.isArray((await demoRequest('GET','/players/1/activity')).matches));
await t('development', async()=>{const r=await demoRequest('GET','/assessments/player/1/development');return Array.isArray(r.criteria);});
await t('teams', async()=>(await demoRequest('GET','/teams')).teams.length===11);
await t('team detail', async()=>{const r=await demoRequest('GET','/teams/1');return r.roster.length>0&&r.record.played>=0;});
await t('coaches', async()=>(await demoRequest('GET','/coaches')).coaches.length===8);
await t('coach detail', async()=>!!(await demoRequest('GET','/coaches/1')).coach.full_name);
await t('tournaments', async()=>(await demoRequest('GET','/tournaments')).tournaments.length===8);
await t('tournament leaders', async()=>{const r=await demoRequest('GET','/tournaments/1');return r.matches.length>0&&r.leaders.length>0;});
await t('matches', async()=>(await demoRequest('GET','/matches')).matches.length>0);
await t('match detail w/ lineup+scorecard', async()=>{const ms=await demoRequest('GET','/matches?status=completed&limit=1');const r=await demoRequest('GET','/matches/'+ms.matches[0].id);return r.lineup.length>0&&r.performances.length>0&&!!r.sport.config;});
await t('training list', async()=>(await demoRequest('GET','/training')).sessions.length>0);
await t('training detail', async()=>{const s=await demoRequest('GET','/training?limit=1');return (await demoRequest('GET','/training/'+s.sessions[0].id)).attendance.length>0;});
await t('assessments', async()=>(await demoRequest('GET','/assessments')).assessments.length===100);
await t('criteria', async()=>(await demoRequest('GET','/assessments/criteria')).criteria.length>0);
await t('achievements', async()=>(await demoRequest('GET','/achievements')).achievements.length>0);
await t('rankings cricket', async()=>{const r=await demoRequest('GET','/rankings?sport=cricket');return r.boards.length>0&&r.boards[0].entries.length>0;});
await t('rankings need a sport', async()=>{try{await demoRequest('GET','/rankings');return false;}catch(e){return e.status===422;}});
await t('search', async()=>{const r=await demoRequest('GET','/search?q=Kar');return Array.isArray(r.teams);});
await t('reports player', async()=>!!(await demoRequest('GET','/reports/player/1')).summary);
await t('reports team', async()=>(await demoRequest('GET','/reports/team/1')).players.length>0);
await t('reports tournament', async()=>Array.isArray((await demoRequest('GET','/reports/tournament/1')).players));
await t('reports sport', async()=>(await demoRequest('GET','/reports/sport/1')).players.length>0);
await t('reports coach', async()=>!!(await demoRequest('GET','/reports/coach/1')).coach);
await t('admin users', async()=>(await demoRequest('GET','/admin/users')).users.length===9);
await t('audit log grows', async()=>(await demoRequest('GET','/admin/audit')).logs.length>0);
await t('roles', async()=>(await demoRequest('GET','/auth/roles')).roles.length===8);
await t('settings', async()=>!!(await demoRequest('GET','/admin/settings')).settings);
await t('csv export', async()=>demoPlayersCsv().includes('Athlete ID'));

// writes
await t('register athlete', async()=>{const r=await demoRequest('POST','/players',{first_name:'Test',last_name:'Newcomer',dob:'2008-05-01'});return r.player.athlete_id.startsWith('KSC-PLY-');});
await t('duplicate rejected', async()=>{try{await demoRequest('POST','/players',{first_name:'Test',last_name:'Newcomer',dob:'2008-05-01'});return false;}catch(e){return e.status===409;}});
await t('save performance updates career', async()=>{
  const ms=await demoRequest('GET','/matches?status=completed&limit=1');const mid=ms.matches[0].id;
  const md=await demoRequest('GET','/matches/'+mid);const pid=md.lineup[0].player_id;
  const before=(await demoRequest('GET','/players/'+pid+'/stats?sport='+md.match.sport_id)).careers[0].career.values;
  const r=await demoRequest('PUT','/matches/'+mid+'/performances',{performances:[{player_id:pid,stats:md.sport.code==='cricket'?{batted:1,runs:113,balls_faced:70,fours:12,sixes:4}:{started:1,minutes:90,goals:3,shots:5,shots_on_target:4,passes:50,passes_completed:40}}]});
  const after=(await demoRequest('GET','/players/'+pid+'/stats?sport='+md.match.sport_id)).careers[0].career.values;
  return r.saved===1 && r.milestones.length>0 && JSON.stringify(before)!==JSON.stringify(after);
});
await t('invalid stats rejected', async()=>{
  const ms=await demoRequest('GET','/matches?status=completed&limit=1');const mid=ms.matches[0].id;
  const md=await demoRequest('GET','/matches/'+mid);
  try{await demoRequest('PUT','/matches/'+mid+'/performances',{performances:[{player_id:md.lineup[0].player_id,stats:{runs:900,balls_faced:1,shots:1,shots_on_target:9}}]});return false;}catch(e){return e.status===422;}
});

// scoping
await demoRequest('POST','/auth/login',{email:'coach.cricket@karwansc.com',password:'Karwan@2026'});
await t('coach scoped athlete list', async()=>{const r=await demoRequest('GET','/players?pageSize=100');return r.total>0&&r.total<46;});
await t('coach fields redacted', async()=>(await demoRequest('GET','/players?pageSize=1')).players[0]._redacted===true);
await t('coach cannot register', async()=>{try{await demoRequest('POST','/players',{first_name:'No',last_name:'Way'});return false;}catch(e){return e.status===403;}});
await demoRequest('POST','/auth/login',{email:'player@karwansc.com',password:'Karwan@2026'});
await t('player sees only self', async()=>(await demoRequest('GET','/players?pageSize=50')).total===1);

console.log(out.map(([s,n])=>s+'  '+n).join('\n'));
const p=out.filter(r=>r[0]==='PASS').length;
console.log('\n'+p+'/'+out.length+' demo checks passed');
process.exit(p===out.length?0:1);
