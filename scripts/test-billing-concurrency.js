// Opt-in release check. Requires native PostgreSQL binaries on PG_BIN and
// the pg client (may be supplied via NODE_PATH). Ignores DATABASE_URL:
// ALWAYS initializes a fresh password-protected, loopback-only cluster.
const {execFileSync}=require('node:child_process');
const {mkdtempSync,writeFileSync,unlinkSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const {Client}=require('pg');
const {install,issue,voidBill,payment}=require('../tests/helpers/billing-fixture');
async function main(){
  const bin=process.env.PG_BIN;
  if(!bin || !path.isAbsolute(bin)) throw Error('Set PG_BIN to the directory containing initdb and pg_ctl');
  const scratch=mkdtempSync(path.join(tmpdir(),'jobcrest-billing-qa-'));
  const cluster=path.join(scratch,'database'), password=randomBytes(30).toString('hex');
  const run=(name,args,options={})=>execFileSync(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,
    {windowsHide:true,timeout:60000,stdio:['pipe','pipe','pipe'],...options});
  const listener=net.createServer();
  await new Promise((resolve,reject)=>listener.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  const pwfile=path.join(scratch,'init.pw');
  writeFileSync(pwfile,password+'\n',{flag:'wx',mode:0o600});
  try{run('initdb',['-D',cluster,'--no-locale','-E','UTF8','-U','fixture','-A','scram-sha-256','--pwfile='+pwfile]);}
  finally{unlinkSync(pwfile);}
  // The postmaster inherits pg_ctl's handles on Windows. Piped stdio
  // would keep execFileSync waiting for EOF until the server shuts down.
  run('pg_ctl',['-D',cluster,'-l',path.join(scratch,'server.log'),'-o','-h 127.0.0.1 -p '+port,'-w','start'],{stdio:'ignore'});
  const clients=[];
  try{
    for(let i=0;i<3;i++){
      const c=new Client({host:'127.0.0.1',port,user:'fixture',password,database:'postgres',ssl:false,statement_timeout:15000});
      await c.connect();clients.push(c);
    }
    const [a,b,observer]=clients;
    await install(sql=>observer.query(sql));
    await a.query('set role authenticated');
    await b.query("set role authenticated; set test.actor='00000000-0000-4000-8000-000000000002'");
    async function waitUntilBlocked(){
      for(let i=0;i<150;i++){
        const {rows}=await observer.query('select $1::int=any(pg_blocking_pids($2::int)) waiting',[a.processID,b.processID]);
        if(rows[0].waiting)return;
        await new Promise(r=>setTimeout(r,30));
      }
      throw Error('Second connection never waited for the first connection lock');
    }
    const {id}= (await a.query(issue,['d1',0])).rows[0];
    await a.query('begin');
    await a.query('select public.crm_record_invoice_payment($1)',[JSON.stringify(payment(id))]);
    const refused=assert.rejects(b.query(voidBill,[id]),/payments or credits/);
    await waitUntilBlocked();await a.query('commit');await refused;
    assert.deepEqual((await observer.query('select status,amount_paid::int amount from public.crm_invoices where id=$1',[id])).rows,[{status:'partial',amount:50}]);
    console.log('PASS: stale void waited for committed payment and was rejected');
    const old=(await a.query(issue,['d2',0])).rows[0].id;
    await a.query(voidBill,[old]);
    await a.query('begin');
    const replacement=(await a.query(issue,['d2',1])).rows[0].id;
    const waiting=b.query(issue,['d2',1]);
    await waitUntilBlocked();await a.query('commit');
    assert.equal((await waiting).rows[0].id,replacement);
    assert.deepEqual((await observer.query("select count(*)::int n from public.crm_invoices i join public.crm_invoice_items l on l.invoice_id=i.id where i.source_draw_id='d2' and i.status<>'void'")).rows,[{n:1}]);
    console.log('PASS: overlapping admins obtained the same replacement invoice and one line');
    await observer.query(`create function fail_draw() returns trigger language plpgsql as $$begin raise exception 'fixture interruption'; end$$;
      create trigger fail_draw before update on public.crm_progress_billings for each row execute function fail_draw()`);
    await assert.rejects(b.query(voidBill,[replacement]),/fixture interruption/);
    assert.deepEqual((await observer.query("select i.status,d.invoice_id from public.crm_invoices i join public.crm_progress_billings d on d.invoice_id=i.id where i.id=$1",[replacement])).rows,[{status:'draft',invoice_id:replacement}]);
    console.log('PASS: interrupted reopening left invoice and draw unchanged');
  }finally{
    await Promise.allSettled(clients.map(c=>c.end()));
    run('pg_ctl',['-D',cluster,'-m','fast','-w','stop']);
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
