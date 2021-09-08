import Promise from "bluebird"
import _ from "lodash"
import { getUsers, setupDb, setupContracts, setupReddit } from './utils.js'

const GOV_WEIGHT_THRESHOLD=500
const START_BLOCK=17000000
const END_BLOCK=18000000
let db, users, reddit

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
  let countByContent = _.countBy(tips, (t)=>t.contentId)
  // console.log(countByContent)
  let groupByContent = _.groupBy(tips, (t)=>t.contentId)
  let quadScore = {}
  for (const contentId in groupByContent){
    let score = groupByContent[contentId].reduce((res, {tipper})=>{res += Math.sqrt(tipper.weight); return res}, 0)
    const author = groupByContent[contentId][0].post.author.name
    quadScore[author] = quadScore[author] ? quadScore[author] + score : score
  }
  console.log(quadScore)
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
