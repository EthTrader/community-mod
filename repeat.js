import { spawn } from 'child_process';

const MINUTES_5 = 5*60*1000
let count = 0

run()
setInterval(run, MINUTES_5)

function run(){
  console.log(`${++count} ${new Date().toISOString()}`)
  const child = spawn('node', ['index.js']);

  child.stdout.on('data', (data) => {
    console.log(`${data}`);
  });

  child.stderr.on('data', (data)=>{
    console.error(`child stderr:\n${data}`)
    child.kill('SIGINT');
  })

  // forked.on('message', (msg) => {
  //   console.log('Message from child', msg);
  // });
  //
  // forked.send({ hello: 'world' });
}
