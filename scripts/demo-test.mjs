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

await t('login', async()=>{const r=await demoRequest('POST','/auth/login',{email:'admin@playerarc.local',password:'Karwan@2026'});return !!r.token&&r.user.role==='super_admin';});
await t('bad password rejected', async()=>{try{await demoRequest('POST','/auth/login',{email:'admin@playerarc.local',password:'wrong'});return false;}catch(e){return e.status===401;}});
await demoRequest('POST','/auth/login',{email:'admin@playerarc.local',password:'Karwan@2026'});
await t('dashboard', async()=>{const t2=(await demoRequest('GET','/dashboard')).totals;return t2.athletes>0&&t2.sports===7&&t2.matches>0;});
await t('sports+config', async()=>{const r=await demoRequest('GET','/sports');return r.sports.length===7&&r.sports[0].config.matchStats.length>0;});
await t('players list+pagination', async()=>{const r=await demoRequest('GET','/players?pageSize=10');return r.players.length===10&&r.total>10&&r.pages>1&&!!r.players[0].sports;});
await t('player filter by sport', async()=>{const r=await demoRequest('GET','/players?sport=1');return r.total>0&&r.total<46;});
await t('player profile', async()=>{const r=await demoRequest('GET','/players/1');return !!r.player.athlete_id&&r.summary.matches>=0&&Array.isArray(r.teamHistory);});
await t('career stats + rating', async()=>{const r=await demoRequest('GET','/players/1/stats');const c=r.careers.find(x=>x.matchesPlayed>0);return !!c&&c.career.entries.length>0&&c.rating.overall>=0;});
await t('timeline', async()=>(await demoRequest('GET','/players/1/timeline')).events.length>0);
await t('activity', async()=>Array.isArray((await demoRequest('GET','/players/1/activity')).matches));
await t('development', async()=>{const r=await demoRequest('GET','/assessments/player/1/development');return Array.isArray(r.criteria);});
await t('teams', async()=>{const r=await demoRequest('GET','/teams');return r.teams.length>0&&r.teams.every(t2=>t2.sport_name&&t2.squad_size>=0);});
await t('team detail', async()=>{const r=await demoRequest('GET','/teams/1');return r.roster.length>0&&r.record.played>=0;});
await t('coaches', async()=>(await demoRequest('GET','/coaches')).coaches.length===8);
await t('coach detail', async()=>!!(await demoRequest('GET','/coaches/1')).coach.full_name);
await t('tournaments', async()=>{const r=await demoRequest('GET','/tournaments');return r.tournaments.length>0&&r.tournaments.every(x=>x.sport_name);});
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
// Typed statistics are tested on a cricket match with no ball-by-ball record:
// a scored match rebuilds its scorecard from events, which would overwrite a
// manual entry by design.
async function unscoredCricketMatch(){
  const all=await demoRequest('GET','/matches?status=completed&limit=200');
  for(const m of all.matches.filter(x=>x.sport_code==='cricket')){
    const ev=await demoRequest('GET',`/matches/${m.id}/events`);
    if(ev.total===0) return m.id;
  }
  return null;
}
await t('save performance updates career', async()=>{
  const mid=await unscoredCricketMatch();
  const md=await demoRequest('GET','/matches/'+mid);const pid=md.lineup[0].player_id;
  const before=(await demoRequest('GET','/players/'+pid+'/stats?sport='+md.match.sport_id)).careers[0].career.values;
  const r=await demoRequest('PUT','/matches/'+mid+'/performances',{performances:[{player_id:pid,stats:md.sport.code==='cricket'?{batted:1,runs:113,balls_faced:70,fours:12,sixes:4}:{started:1,minutes:90,goals:3,shots:5,shots_on_target:4,passes:50,passes_completed:40}}]});
  const after=(await demoRequest('GET','/players/'+pid+'/stats?sport='+md.match.sport_id)).careers[0].career.values;
  return r.saved===1 && r.milestones.length>0 && JSON.stringify(before)!==JSON.stringify(after);
});
await t('invalid stats rejected', async()=>{
  const mid=await unscoredCricketMatch();
  const md=await demoRequest('GET','/matches/'+mid);
  try{await demoRequest('PUT','/matches/'+mid+'/performances',{performances:[{player_id:md.lineup[0].player_id,stats:{runs:900,balls_faced:1,shots:1,shots_on_target:9}}]});return false;}catch(e){return e.status===422;}
});

// user management
await t('create + sign in as new user', async()=>{
  await demoRequest('POST','/auth/login',{email:'admin@playerarc.local',password:'Karwan@2026'});
  const r=await demoRequest('POST','/admin/users',{full_name:'Temp Coach',email:'temp@karwansportsclub.com',password:'Temporary123',role:'coach',teamIds:[1]});
  const l=await demoRequest('POST','/auth/login',{email:'temp@karwansportsclub.com',password:'Karwan@2026'});
  return r.ok && l.user.role==='coach';
});
await t('generate password + forced change', async()=>{
  await demoRequest('POST','/auth/login',{email:'admin@playerarc.local',password:'Karwan@2026'});
  const u=(await demoRequest('GET','/admin/users')).users.find(x=>x.email==='temp@karwansportsclub.com');
  const r=await demoRequest('POST',`/admin/users/${u.id}/password`,{mustChange:true});
  const l=await demoRequest('POST','/auth/login',{email:'temp@karwansportsclub.com',password:r.password});
  return r.generated && l.user.mustChangePassword===true;
});
await t('user changes their own password', async()=>{
  await demoRequest('POST','/auth/login',{email:'admin@playerarc.local',password:'Karwan@2026'});
  const u=(await demoRequest('GET','/admin/users')).users.find(x=>x.email==='temp@karwansportsclub.com');
  await demoRequest('POST',`/admin/users/${u.id}/password`,{password:'KnownPass123',mustChange:true});
  await demoRequest('POST','/auth/login',{email:'temp@karwansportsclub.com',password:'KnownPass123'});
  await demoRequest('POST','/auth/change-password',{currentPassword:'KnownPass123',newPassword:'MyOwnPass456'});
  const l=await demoRequest('POST','/auth/login',{email:'temp@karwansportsclub.com',password:'MyOwnPass456'});
  return l.user.mustChangePassword===false;
});
await t('cannot delete own account', async()=>{
  await demoRequest('POST','/auth/login',{email:'admin@playerarc.local',password:'Karwan@2026'});
  const me=(await demoRequest('GET','/admin/users')).users.find(x=>x.email==='admin@playerarc.local');
  try{await demoRequest('DELETE',`/admin/users/${me.id}`);return false;}catch(e){return e.status===409;}
});
await t('delete a user', async()=>{
  const u=(await demoRequest('GET','/admin/users')).users.find(x=>x.email==='temp@karwansportsclub.com');
  return (await demoRequest('DELETE',`/admin/users/${u.id}`)).ok;
});
await t('no password ever leaves the user list', async()=>{
  const s=JSON.stringify(await demoRequest('GET','/admin/users'));
  return !s.includes('password_hash') && !s.includes('"password"');
});

// athlete assignments
await t('assign staff to an athlete', async()=>(await demoRequest('POST','/players/1/staff',{coach_id:1,role:'personal_trainer'})).ok);
await t('duplicate staff refused', async()=>{
  try{await demoRequest('POST','/players/1/staff',{coach_id:1,role:'personal_trainer'});return false;}catch(e){return e.status===409;}
});
await t('staff shows on profile', async()=>(await demoRequest('GET','/players/1')).staff.some(x=>x.role==='personal_trainer'));
await t('end staff assignment, keep the row', async()=>{
  const a=(await demoRequest('GET','/players/1')).staff.find(x=>!x.end_date);
  await demoRequest('PUT',`/players/1/staff/${a.id}`,{end_date:new Date().toISOString().slice(0,10)});
  return (await demoRequest('GET','/players/1')).staff.some(x=>x.id===a.id&&x.end_date);
});
await t('assign athlete to a team from their profile', async()=>{
  const before=(await demoRequest('GET','/players/1')).teamHistory.length;
  const teams=(await demoRequest('GET','/teams')).teams;
  const on=new Set((await demoRequest('GET','/players/1')).teamHistory.map(x=>x.team_id));
  const free=teams.find(x=>!on.has(x.id));
  await demoRequest('POST',`/teams/${free.id}/members`,{player_id:1,role:'player'});
  return (await demoRequest('GET','/players/1')).teamHistory.length===before+1;
});

// ball-by-ball capture and analysis
let bbId=null;
for(const m of (await demoRequest('GET','/matches?limit=200')).matches.filter(x=>x.sport_code==='cricket')){
  const ev=await demoRequest('GET',`/matches/${m.id}/events`);
  if(ev.total>50){bbId=m.id;break;}
}
await t('a cricket match is scored ball by ball', async()=>{
  const ev=await demoRequest('GET',`/matches/${bbId}/events`);
  return ev.total>50 && ev.events.some(e=>e.commentary&&e.commentary.includes(' to '));
});
await t('analysis returns per-innings detail', async()=>{
  const a=await demoRequest('GET',`/matches/${bbId}/analysis`);
  return a.periods.length>=2 && a.periods[0].battingCard.length>0 && a.periods[0].bowlingCard.length>0;
});
await t('innings are not merged', async()=>{
  const a=await demoRequest('GET',`/matches/${bbId}/analysis`);
  const scored=a.periods.filter(p=>p.summary.balls>0);
  return scored.length>=2 && scored.every(p=>p.summary.balls<=80) && a.overall.summary.innings===a.periods.length;
});
await t('wagon wheel, pitch map, phases, partnerships', async()=>{
  const inn=(await demoRequest('GET',`/matches/${bbId}/analysis`)).periods[0];
  return inn.wagonWheel.length>0 && inn.pitchMap.length>0 && inn.phases.length>0 && inn.partnerships.length>0;
});
await t('scorecard matches the analysis exactly', async()=>{
  const a=await demoRequest('GET',`/matches/${bbId}/analysis`);
  const md=await demoRequest('GET',`/matches/${bbId}`);
  const totals=new Map();
  for(const period of a.periods){
    for(const b of period.battingCard.filter(x=>x.playerId)){
      const cur=totals.get(b.playerId)||{runs:0,balls:0};
      totals.set(b.playerId,{runs:cur.runs+b.runs,balls:cur.balls+b.balls});
    }
  }
  const sample=[...totals.entries()].slice(0,4);
  return sample.length>0 && sample.every(([pid,exp])=>{
    const perf=md.performances.find(p=>p.player_id===pid);
    return perf && perf.stats.runs===exp.runs && perf.stats.balls_faced===exp.balls;
  });
});
await t("an athlete's own match view", async()=>{
  const a=await demoRequest('GET',`/matches/${bbId}/analysis`);
  const who=a.periods[0].battingCard.find(b=>b.playerId);
  const v=await demoRequest('GET',`/matches/${bbId}/analysis/player/${who.playerId}`);
  return v.events>0 && v.performance!==null;
});
let demoPeriodId;
await t('open a period and record a delivery', async()=>{
  const existing=await demoRequest('GET',`/matches/${bbId}/periods`);
  const seq=Math.max(0,...existing.periods.map(p=>p.sequence))+1;
  const {period}=await demoRequest('POST',`/matches/${bbId}/periods`,{sequence:seq,label:`Test innings ${seq}`,planned_length:20,status:'in_progress'});
  demoPeriodId=period.id;
  const md=await demoRequest('GET',`/matches/${bbId}`);
  const before=(await demoRequest('GET',`/players/${md.lineup[0].player_id}/stats?sport=cricket`)).careers[0].career.values.runs;
  const r=await demoRequest('POST',`/matches/${bbId}/events`,{
    period_id:demoPeriodId,event_type:'ball',
    primary_player_id:md.lineup[0].player_id,secondary_player_id:md.lineup[1].player_id,
    outcome:'six',payload:{runs_batter:6,shot:'pull'},x:30,y:70,
  });
  const after=(await demoRequest('GET',`/players/${md.lineup[0].player_id}/stats?sport=cricket`)).careers[0].career.values.runs;
  return r.event.over_number===0 && r.event.ball_in_over===1 && after===before+6;
});
await t('a wide is re-bowled rather than advancing the over', async()=>{
  const md=await demoRequest('GET',`/matches/${bbId}`);
  const wide=await demoRequest('POST',`/matches/${bbId}/events`,{
    period_id:demoPeriodId,event_type:'ball',
    primary_player_id:md.lineup[0].player_id,secondary_player_id:md.lineup[1].player_id,
    outcome:'wide',payload:{extras:1,extra_type:'wide'},
  });
  const after=await demoRequest('POST',`/matches/${bbId}/events`,{
    period_id:demoPeriodId,event_type:'ball',
    primary_player_id:md.lineup[0].player_id,secondary_player_id:md.lineup[1].player_id,
    outcome:'dot',payload:{runs_batter:0},
  });
  return after.event.over_number===wide.event.over_number && after.event.ball_in_over===wide.event.ball_in_over;
});
await t('undo removes the last delivery', async()=>{
  const ev=await demoRequest('GET',`/matches/${bbId}/events?period=${demoPeriodId}`);
  await demoRequest('DELETE',`/matches/${bbId}/events/${ev.events.at(-1).id}`);
  const after=await demoRequest('GET',`/matches/${bbId}/events?period=${demoPeriodId}`);
  return after.events.length===ev.events.length-1;
});
await t('unknown event types refused', async()=>{
  try{await demoRequest('POST',`/matches/${bbId}/events`,{event_type:'touchdown',payload:{}});return false;}
  catch(e){return e.status===422;}
});
await t('out-of-range values refused', async()=>{
  try{await demoRequest('POST',`/matches/${bbId}/events`,{period_id:demoPeriodId,event_type:'ball',payload:{runs_batter:99}});return false;}
  catch(e){return e.status===422;}
});
await t('football and racket analysis shapes', async()=>{
  const ms=(await demoRequest('GET','/matches?limit=200')).matches;
  let football=false, racket=false;
  for(const m of ms.filter(x=>x.sport_code==='football')){
    const a=await demoRequest('GET',`/matches/${m.id}/analysis`);
    if(a.totalEvents>0){football=a.overall.shotMap.length>0&&a.overall.timeline.length>0;break;}
  }
  for(const m of ms.filter(x=>x.sport_code==='badminton')){
    const a=await demoRequest('GET',`/matches/${m.id}/analysis`);
    if(a.totalEvents>0){racket=a.overall.progression.length>0&&a.overall.rallyBuckets.length>0;break;}
  }
  return football&&racket;
});

// drills, plans, benchmarks, announcements, showcase
await t('drill library', async()=>{
  const r=await demoRequest('GET','/drills');
  return r.drills.length>5 && r.drills.every(d=>d.category && d.times_used>=0);
});
await t('session plans carry ordered drills', async()=>{
  const r=await demoRequest('GET','/session-templates');
  return r.templates.length>0 && r.templates.every(x=>x.drills.every((d,i)=>d.sort_order===i));
});
await t('build a session from a plan', async()=>{
  const s2=(await demoRequest('GET','/training?limit=1')).sessions[0];
  const tpl=(await demoRequest('GET','/session-templates')).templates[0];
  await demoRequest('POST',`/training/${s2.id}/apply-template/${tpl.id}`);
  const after=await demoRequest('GET',`/training/${s2.id}/drills`);
  return after.drills.length===tpl.drills.length;
});
await t('add a drill', async()=>{
  const r=await demoRequest('POST','/drills',{name:'Demo drill '+Date.now(),category:'skills',duration_minutes:15});
  return !!r.drill?.id;
});
await t('benchmarks band an athlete', async()=>{
  for(const p of (await demoRequest('GET','/players?pageSize=60')).players){
    const b=await demoRequest('GET',`/players/${p.id}/benchmarks`);
    if(b.career.length) return ['below','developing','competent','strong','exceptional'].includes(b.career[0].band)&&!!b.ageGroup;
  }
  return false;
});
await t('announcements list and send', async()=>{
  const team=(await demoRequest('GET','/teams')).teams[0];
  const r=await demoRequest('POST','/announcements',{title:'Demo notice',body:'Moved.',audience:'team',team_id:team.id});
  const list=await demoRequest('GET','/announcements');
  return !!r.announcement?.id && list.announcements.some(a=>a.id===r.announcement.id);
});
await t('a squad announcement needs a squad', async()=>{
  try{await demoRequest('POST','/announcements',{title:'x',body:'y',audience:'team'});return false;}
  catch(e){return e.status===422;}
});
await t('showcase publishes, reads and withdraws', async()=>{
  const p=(await demoRequest('GET','/players?pageSize=1')).players[0];
  const on=await demoRequest('PUT',`/players/${p.id}/showcase`,{enabled:true,headline:'Available for trials.'});
  const pub=await demoRequest('GET',`/players/showcase/${on.token}`);
  const body=JSON.stringify(pub);
  const clean=!['"phone"','"guardian_name"','"address"','"emergency_phone"'].some(f=>body.includes(f));
  await demoRequest('PUT',`/players/${p.id}/showcase`,{enabled:false});
  let gone=false;
  try{await demoRequest('GET',`/players/showcase/${on.token}`);}catch(e){gone=e.status===404;}
  return !!pub.athlete.name && clean && gone;
});
await t('every sport has event definitions', async()=>{
  const sports=(await demoRequest('GET','/sports')).sports;
  return sports.length===7 && sports.every(s2=>s2.config?.events?.types?.length>0);
});
await t('every sport has events recorded', async()=>{
  const sports=(await demoRequest('GET','/sports')).sports;
  const ms=(await demoRequest('GET','/matches?limit=200')).matches;
  let covered=0;
  for(const sp of sports){
    for(const m of ms.filter(x=>x.sport_code===sp.code)){
      const ev=await demoRequest('GET',`/matches/${m.id}/events`);
      if(ev.total>0){covered+=1;break;}
    }
  }
  return covered===sports.length;
});

// ball tracking, fitness, templates, selection
let tsId;
await t('tracking sessions with calibration', async()=>{
  const r=await demoRequest('GET','/tracking/sessions');
  tsId=r.sessions[0]?.id;
  return r.sessions.length>5 && r.sessions.every(x=>x.calibrated===1) && r.sessions.some(x=>x.mode==='bowling_machine');
});
await t('session reports speed, map, stumps, consistency', async()=>{
  const r=await demoRequest('GET',`/tracking/sessions/${tsId}`);
  const s2=r.summary;
  return s2.speed.averageRelease>50 && s2.pitchMap.points.length>0 && s2.stumpLine.assessed>0 && s2.consistency.hitRate>=0;
});
await t('pitch coordinates resolve to the right zones', async()=>{
  const r=await demoRequest('GET',`/tracking/sessions/${tsId}`);
  return r.deliveries.filter(d=>d.length_zone==='good').every(d=>d.pitch_y_cm>400&&d.pitch_y_cm<=700);
});
await t('recording a delivery derives its zones', async()=>{
  const s2=await demoRequest('GET',`/tracking/sessions/${tsId}`);
  const r=await demoRequest('POST',`/tracking/sessions/${tsId}/deliveries`,{
    bowler_id:s2.bowlers[0]?.player.id??null, batter_handedness:'right',
    release_speed_kph:139.4, speed_off_pitch_kph:104.2,
    pitch_x_cm:14, pitch_y_cm:560, stump_x_cm:6, stump_z_cm:40, delivery_type:'seam', runs:0,
  });
  const d=r.deliveries[0];
  return d.length_zone==='good' && d.line_zone==='off_stump' && d.hits_stumps===1 && d.stump_hit==='off';
});
await t('bowling-machine session needs its speed', async()=>{
  try{await demoRequest('POST','/tracking/sessions',{sport_id:1,mode:'bowling_machine',title:'x',session_date:'2026-09-01'});return false;}
  catch(e){return e.status===422;}
});
await t('scene calibration recorded', async()=>{
  const c=await demoRequest('POST','/tracking/sessions',{sport_id:1,mode:'nets',title:'Cal '+Date.now(),session_date:'2026-09-01'});
  const r=await demoRequest('PUT',`/tracking/sessions/${c.session.id}/calibration`,{method:'crease_markers',stump_height_cm:71.1});
  return r.session.calibrated===1 && r.session.calibration_method==='crease_markers';
});
await t('athlete tracking report spans sessions', async()=>{
  const s2=await demoRequest('GET',`/tracking/sessions/${tsId}`);
  const r=await demoRequest('GET',`/players/${s2.bowlers[0].player.id}/tracking`);
  return r.bowling.deliveries>0 && r.bowling.trend.length>0 && r.bowling.consistency.score>=0;
});
await t('fitness trends per metric', async()=>{
  for(const p of (await demoRequest('GET','/players?pageSize=40')).players){
    const f=await demoRequest('GET',`/players/${p.id}/fitness`);
    if(f.series.length) return f.series.every(m2=>m2.points.length>0&&m2.latest!==null);
  }
  return false;
});
await t('a faster sprint counts as improvement', async()=>{
  for(const p of (await demoRequest('GET','/players?pageSize=40')).players){
    const f=await demoRequest('GET',`/players/${p.id}/fitness`);
    const sp=f.series.find(m2=>m2.metric==='sprint_20m');
    if(sp) return sp.higherIsBetter===false && sp.improved===(sp.change<0);
  }
  return false;
});
await t('assessment templates carry ordered criteria', async()=>{
  const r=await demoRequest('GET','/assessment-templates');
  return r.templates.length>=4 && r.templates.every(x=>x.criteria.length>0&&x.criteria.every((c,i)=>c.sort_order===i));
});
await t('selection compares on shared measures', async()=>{
  const ids=(await demoRequest('GET','/players?sport=1&pageSize=4')).players.map(p=>p.id);
  const r=await demoRequest('GET',`/selection/compare?sport=1&players=${ids.join(',')}`);
  return r.rows.length>=2 && r.columns.length>0;
});

// athlete portal logins, kept apart from staff accounts
await t('athlete logins listed apart from staff', async()=>{
  const r=await demoRequest('GET','/admin/athlete-logins');
  return r.logins.length>0 && r.athletesWithoutLogin.length>0 && r.logins.every(l=>!('role' in l));
});
await t('one login per athlete', async()=>{
  const r=await demoRequest('GET','/admin/athlete-logins');
  try{await demoRequest('POST','/admin/athlete-logins',{player_id:r.logins[0].player_id,email:'dupe'+Date.now()+'@athlete.playerarc.local'});return false;}
  catch(e){return e.status===409;}
});
await t('athlete cannot reuse a staff address', async()=>{
  const r=await demoRequest('GET','/admin/athlete-logins');
  try{await demoRequest('POST','/admin/athlete-logins',{player_id:r.athletesWithoutLogin[0].id,email:'admin@playerarc.local'});return false;}
  catch(e){return e.status===409;}
});
await t('issuing a login creates no athlete', async()=>{
  const before=(await demoRequest('GET','/players?pageSize=1')).total;
  const r=await demoRequest('GET','/admin/athlete-logins');
  const made=await demoRequest('POST','/admin/athlete-logins',{player_id:r.athletesWithoutLogin[0].id,email:'issued'+Date.now()+'@athlete.playerarc.local'});
  const after=(await demoRequest('GET','/players?pageSize=1')).total;
  return !!made.password && before===after;
});
await t('removing a login leaves the athlete', async()=>{
  const r=await demoRequest('GET','/admin/athlete-logins');
  const made=await demoRequest('POST','/admin/athlete-logins',{player_id:r.athletesWithoutLogin[0].id,email:'temp'+Date.now()+'@athlete.playerarc.local'});
  const before=(await demoRequest('GET','/players?pageSize=1')).total;
  await demoRequest('DELETE',`/admin/athlete-logins/${made.id}`);
  const after=(await demoRequest('GET','/players?pageSize=1')).total;
  return before===after;
});
await t('only the administrator manages athlete logins', async()=>{
  await demoRequest('POST','/auth/login',{email:'coach.cricket@karwansportsclub.com',password:'Karwan@2026'});
  let blocked=false;
  try{await demoRequest('GET','/admin/athlete-logins');}catch(e){blocked=e.status===403;}
  await demoRequest('POST','/auth/login',{email:'admin@playerarc.local',password:'Karwan@2026'});
  return blocked;
});

// scoping
await demoRequest('POST','/auth/login',{email:'coach.cricket@karwansportsclub.com',password:'Karwan@2026'});
await t('coach scoped athlete list', async()=>{const r=await demoRequest('GET','/players?pageSize=100');return r.total>0&&r.total<46;});
await t('coach fields redacted', async()=>(await demoRequest('GET','/players?pageSize=1')).players[0]._redacted===true);
await t('coach cannot register', async()=>{try{await demoRequest('POST','/players',{first_name:'No',last_name:'Way'});return false;}catch(e){return e.status===403;}});
await demoRequest('POST','/auth/login',{email:'player@karwansportsclub.com',password:'Karwan@2026'});
await t('player sees only self', async()=>(await demoRequest('GET','/players?pageSize=50')).total===1);

console.log(out.map(([s,n])=>s+'  '+n).join('\n'));
const p=out.filter(r=>r[0]==='PASS').length;
console.log('\n'+p+'/'+out.length+' demo checks passed');
process.exit(p===out.length?0:1);
