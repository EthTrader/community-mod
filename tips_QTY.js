import Promise from "bluebird"
import _ from "lodash"
import { wait, getUsers, setupDb, setupContracts, setupReddit } from './utils.js'
import fs from "fs"
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GOV_WEIGHT_THRESHOLD=500
const START_BLOCK=20195001
const END_BLOCK=20675285
const label = "round_107"

let db, users, reddit

const donutUpvoterTotalReward = 340000
const quadRankTotalReward = 680000

const out = {label, startBlock: START_BLOCK, endBlock: END_BLOCK, govWeightThreshold: GOV_WEIGHT_THRESHOLD, donutUpvoterTotalReward, quadRankTotalReward}

main()

async function main(){
  users = await getUsers()
  db = await setupDb()
  reddit = setupReddit()

  const donutUpvoterRewards = {}
  const quadRankRewards = {}

  let tips = db.chain.get("tips").filter(inRange).filter(isPost).map(addTipper).value()
  tips = await Promise.mapSeries(tips, addPost)
  tips = tips.filter(isDonutUpvote)

  // TODO - check banned/suspended accounts

  console.log(`tips: ${tips.length}`)
  let countByName = _.countBy(tips, (t)=>t.tipper.username)

  let eligibleTipCount = tips.length

  const names = Object.keys(countByName)
  tips.forEach(t=>{
    const name = t.post.author.name
    if(!names.includes(name)) names.push(name)
  })
  console.log(`names: ${names.length}`)
  const ineligbleNames = await Promise.mapSeries(names, invalidAccount)
  console.log(`ineligble names: ${ineligbleNames.join(', ')}`)

  for (const name in countByName){
    if(ineligbleNames.includes(name)) {
      eligibleTipCount -= countByName[name]
      delete countByName[name]
    }
  }
  for (const name in countByName){
    donutUpvoterRewards[name] = Math.round(countByName[name])
  }

  let groupByContent = _.groupBy(tips, (t)=>t.contentId)
  let quadScores = {}
  for (const contentId in groupByContent){
    const author = groupByContent[contentId][0].post.author.name
    if(ineligbleNames.includes(author)) continue

    let score = 1
    quadScores[author] = quadScores[author] ? quadScores[author] + score : score
  }
  for (const author in quadScores){
    quadRankRewards[author] = Math.round(quadScores[author])
  }

  console.log(out)
  out.rewards = Object.keys(donutUpvoterRewards).map(key => ({ username: key, tips_given: donutUpvoterRewards[key], tips_received:  "0"}))
  
  console.log("checking authors")
  for (const k in quadRankRewards) {
    const check = false;
    console.log("checking if " + k + " was a tipper...")
    for (const d in out.rewards) {
      if (Object.values(out.rewards[d]).includes(k)) {
        console.log("we found a match! " + k)
        out.rewards[d].tips_received = quadRankRewards[k]
        const check = true
      } 
    }

    if (check == false) {
      console.log(k + " did not tip anyone")
      out.rewards = out.rewards.concat({ username: k, tips_given: "0", tips_received: quadRankRewards[k]})
    }
  }
  
  
  fs.writeFileSync( `${__dirname}/docs/donut_upvote_rewards_${label}QTY.json`, JSON.stringify(out))
}

function inRange({blockNumber}){
  return blockNumber > START_BLOCK && blockNumber < END_BLOCK
}

async function invalidAccount(name){
  await wait(1500)
  if(name == "[deleted]") return name
  let user
  try {
    console.log(`checking ${name}`)
    user = await reddit.getUser(name).fetch()
  } catch(e){
    console.log(e)
  }
  if(!user || user.is_suspended) return name
  else return null
}

function isPost({contentId}){
  return contentId.substr(0,3) === "t3_"
}

function addTipper(tip){
  tip.tipper = users.find((u)=>u.address.toLowerCase()===tip.from.toLowerCase())
  return tip
}

async function addPost(tip){
  await wait(1500)
  console.log(tip.contentId)
  tip.post = await reddit.getSubmission(tip.contentId).fetch()
  return tip
}

function isDonutUpvote({to, contentId, tipper, post}){
  if(!tipper) return false
  if(tipper.username == post.author.name) return false
  return parseInt(tipper.weight) >= GOV_WEIGHT_THRESHOLD
}
