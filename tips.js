import Promise from "bluebird"
import _ from "lodash"
import { wait, getUsers, setupDb, setupContracts, setupReddit } from './utils.js'
import fs from "fs"
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GOV_WEIGHT_THRESHOLD=500
const START_BLOCK=23038000
const END_BLOCK=23512000  //roughly 17,250 blocks per day
const label = "round_113"

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
  let countByAddress = _.countBy(tips, (t)=>t.from.toLowerCase())
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
    donutUpvoterRewards[name] = Math.round(countByName[name]*donutUpvoterTotalReward/eligibleTipCount)
  }

  let groupByContent = _.groupBy(tips, (t)=>t.contentId)
  let quadScoreTotal = 0
  let quadScores = {}
  for (const contentId in groupByContent){
    const author = groupByContent[contentId][0].post.author.name
    if(ineligbleNames.includes(author)) continue

    let score = groupByContent[contentId].reduce((res, {tipper})=>{res += Math.sqrt(tipper.weight); return res}, 0)
    quadScores[author] = quadScores[author] ? quadScores[author] + score : score
    quadScoreTotal += score
  }
  for (const author in quadScores){
    quadRankRewards[author] = Math.round(quadScores[author]*quadRankTotalReward/quadScoreTotal)
  }
  // console.log(out)
  out.rewards = Object.keys(donutUpvoterRewards).map(key => ({ username: key, points: donutUpvoterRewards[key], contributor_type: "donut_upvoter" }))
  out.rewards = out.rewards.concat(Object.keys(quadRankRewards).map(key => ({ username: key, points: quadRankRewards[key], contributor_type: "quad_rank" })))
  fs.writeFileSync( `${__dirname}/docs/donut_upvote_rewards_${label}.json`, JSON.stringify(out))
}

function inRange({blockNumber}){
  return blockNumber > START_BLOCK && blockNumber < END_BLOCK
}

async function invalidAccount(name){
  await wait(2500)
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
  await wait(2000)
  console.log(tip.contentId)
  tip.post = await reddit.getSubmission(tip.contentId).fetch()
  return tip
}

function isDonutUpvote({to, contentId, tipper, post}){
  if(!tipper) return false
  if(tipper.username == post.author.name) return false
  return parseInt(tipper.weight) >= GOV_WEIGHT_THRESHOLD
}
