import Promise from "bluebird"
import _ from "lodash"
import { getUsers, setupDb, setupContracts, setupReddit } from './utils.js'
import fs from "fs"
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GOV_WEIGHT_THRESHOLD=500
const START_BLOCK=17876913
const END_BLOCK=18334566
const label = "round_102"

let db, users, reddit

const donutUpvoterTotalReward = 340000
const quadRankTotalReward = 680000

const out = {label, startBlock: START_BLOCK, endBlock: END_BLOCK, govWeightThreshold: GOV_WEIGHT_THRESHOLD, donutUpvoterTotalReward, donutUpvoterRewards:{}, quadRankTotalReward, quadRankRewards:{}}

main()

async function main(){
  users = await getUsers()
  db = await setupDb()
  reddit = setupReddit()

  let tips = db.chain.get("tips").filter(inRange).filter(isPost).map(addTipper).value()
  tips = await Promise.map(tips, addPost)
  tips = await Promise.filter(tips, isDonutUpvote)

  // TODO - check banned/suspended accounts

  console.log(tips.length)
  let countByAddress = _.countBy(tips, (t)=>t.from.toLowerCase())
  let countByName = _.countBy(tips, (t)=>t.tipper.username)
  // console.log(countByAddress)
  // console.log(countByName)
  for (const name in countByName){
    out.donutUpvoterRewards[name] = Math.round(countByName[name]*donutUpvoterTotalReward/tips.length)
  }
  let countByContent = _.countBy(tips, (t)=>t.contentId)
  // console.log(countByContent)
  let groupByContent = _.groupBy(tips, (t)=>t.contentId)
  let quadScoreTotal = 0
  let quadScores = {}
  for (const contentId in groupByContent){
    let score = groupByContent[contentId].reduce((res, {tipper})=>{res += Math.sqrt(tipper.weight); return res}, 0)
    const author = groupByContent[contentId][0].post.author.name
    quadScores[author] = quadScores[author] ? quadScores[author] + score : score
    quadScoreTotal += score
  }
  for (const author in quadScores){
    out.quadRankRewards[author] = Math.round(quadScores[author]*quadRankTotalReward/quadScoreTotal)
  }
  console.log(out)
  fs.writeFileSync( `${__dirname}/out/donut_upvote_rewards_${label}.json`, JSON.stringify(out))
  out.donutUpvoterRewards = Object.keys(out.donutUpvoterRewards).map(key => ({ username: key, points: out.donutUpvoterRewards[key] }))
  out.quadRankRewards = Object.keys(out.quadRankRewards).map(key => ({ username: key, points: out.quadRankRewards[key] }))
  out.donutUpvoterRewards.sort((a,b)=>b.points-a.points)
  out.quadRankRewards.sort((a,b)=>b.points-a.points)
  fs.writeFileSync( `${__dirname}/out/donut_upvote_rewards_${label}_lists.json`, JSON.stringify(out))
}

function inRange({blockNumber}){
  return blockNumber > START_BLOCK && blockNumber < END_BLOCK
}

function isPost({contentId}){
  return contentId.substr(0,3) === "t3_"
}

function addTipper(tip){
  tip.tipper = users.find((u)=>u.address.toLowerCase()===tip.from.toLowerCase())
  return tip
}

async function addPost(tip){
  tip.post = await reddit.getSubmission(tip.contentId).fetch()
  return tip
}

async function isDonutUpvote({to, contentId, tipper, post}){
  if(!tipper) return false
  if(tipper.username == post.author.name) return false
  return parseInt(tipper.weight) >= GOV_WEIGHT_THRESHOLD
}
