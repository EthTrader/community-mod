import Promise from "bluebird"
import snoowrap from "snoowrap"
import _ from "lodash"
import fs from "fs"
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORIGIN = 1654722000      // this represenents the Unix time of the first  FEE period begining on 6/08/2022

const ROUND = 116
const LABEL = `round_${ROUND}`
const FILE = `${LABEL}.csv`
const START = ORIGIN + (2419200 * (ROUND-112))
const END = ORIGIN + (2419200 * (ROUND-111))
const FEE = 250                                         // donut cost per post (PAY2POST)

console.log(`${START}::::${END}`)

const credentials = {
  userAgent: 'Read Bot 1.0 by u/EthTraderCommunity',
  clientId: process.env.REDDIT_SCRIPT_CLIENT_ID,
  clientSecret: process.env.REDDIT_SCRIPT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD
}

const reddit = new snoowrap(credentials)

const out = {label: LABEL, startDate: START, endDate: END}

main()

async function main(){
    reddit.getInbox({filter:'mentions', limit: Infinity}).then(mentionsList => {

    let names = []

    for (const mention of mentionsList) {
      if (mention.created_utc >= START && mention.created_utc <= END) {
        if (mention.author_fullname == "t2_6l4z3") {
          let username = mention.body.split(/\r?\n/).filter(e=>e)
          username = username[2].substring(8)
          names.push(username)
        } else {
          null
        }
      }
    }


    
    var count = names.reduce(function(prev, cur) {
      prev[cur] = (prev[cur] || 0) + 1;
      return prev;
    }, {});


    out.count = Object.entries(count).map(([key, value]) => ({ username: key, points: value, donutFee: value * FEE}))
    fs.writeFileSync( `${__dirname}/docs/pay2post_${LABEL}.json`, JSON.stringify(out))

    console.log(out)

    let total = 0;
    for (const key in count) {
        total += count[key]
    }
    console.log(`total posts in Round ${ROUND}: ${total}`)
  })
}


const wait = ms => new Promise(resolve => setTimeout(resolve, ms));


