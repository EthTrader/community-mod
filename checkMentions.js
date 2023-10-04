import Promise from "bluebird"
import snoowrap from "snoowrap"
import _ from "lodash"
import fs from "fs"
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORIGIN = 1654722000      // this represenents the Unix time of the first  FEE period begining on 6/08/2022

const ROUND = 127
const LABEL = `round_${ROUND}`
const FILE = `${LABEL}.csv`
const START = ORIGIN + (2419200 * (ROUND-112))
// const START = 1693229200
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
  let counter = 0;
  let names = [];
  let lastPost;
  let stop = false;

  while (!stop) {
    // const options = { limit: Infinity };
    // if (lastPost) options.before = lastPost.name;

    const posts = await reddit.getSubreddit('ethtrader').getNew();
    if (posts.length === 0) break;

    for (const post of posts) {
      const created = post.created_utc;
    //   if (created < START) return names;
      if (created < START) {
        stop = true;
        break;
      }


      if (created <= END) {
        counter++
        names.push(post.author.name);
        // console.log(counter + " -- " + post.author.name + " -- " + post.created_utc + " -- " + post.removed + " -- " + post.removed_by)
      }
    }

    lastPost = posts[posts.length - 1];
    console.log(names.length)
  }

  var count = names.reduce(function(prev, cur) {
    prev[cur] = (prev[cur] || 0) + 1;
    return prev;
  }, {});


  out.count = Object.entries(count).map(([key, value]) => ({ username: key, points: value, donutFee: value * FEE}))
  fs.writeFileSync( `${__dirname}/docs/authors_${LABEL}.json`, JSON.stringify(out))
}
