// const { ethers } from "ethers")
import fs from 'fs'
import { ethers } from 'ethers'
const { BigNumber, utils, constants, providers, Contract } = ethers
const { formatUnits, Fragment, Interface, parseBytes32String } = utils
import snoowrap from "snoowrap"
import Promise from "bluebird"
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
dayjs.extend(utc)
import fetch from "node-fetch"
fetch.Promise = Promise

import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TippingABI = JSON.parse(fs.readFileSync(`${__dirname}/abis/Tipping.json`));
const ERC20ABI = JSON.parse(fs.readFileSync(`${__dirname}/abis/ERC20.json`));
// import TippingABI from "./abis/Tipping.json"
// import ERC20ABI from "./abis/ERC20.json"
import lodash from "lodash"
import { LowSync, JSONFileSync } from "lowdb"

const adapter = new JSONFileSync("db.json")

const COMEDY_FLAIR_ID = "fd58a15c-e93f-11e5-a0f2-0e293b108187"
const MEDIA_FLAIR_ID = "fc5ec82c-3c36-11eb-8acd-0ebbc912e7bb"
const MINUTES_1 = 1*60*1000
const MINUTES_5 = 5*60*1000
const MINUTES_10 = 10*60*1000
const GRACE_HRS = 6

const {
  REDDIT_SCRIPT_CLIENT_ID, REDDIT_SCRIPT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD,
  JSON_RPC_PROVIDER_XDAI, WSS_PROVIDER_XDAI, WSS_PROVIDER_MAINNET, TIPPING_ADDRESS_XDAI } = process.env

const reddit = new snoowrap({
  userAgent: "EthTrader tipping 1.0 by u/EthTraderCommunity",
  clientId: REDDIT_SCRIPT_CLIENT_ID,
  clientSecret: REDDIT_SCRIPT_CLIENT_SECRET,
  username: REDDIT_USERNAME,
  password: REDDIT_PASSWORD
})
const xdai = new providers.JsonRpcProvider(JSON_RPC_PROVIDER_XDAI)

const tipping = new Contract(TIPPING_ADDRESS_XDAI, TippingABI, xdai)
let db, heartbeat, users

main()

async function main(){
  users = await fetch("https://ethtrader.github.io/donut.distribution/users.json").then(res=>res.json())
  db = new LowSync(adapter)
  await db.read()
  db.data = db.data || { tips: [], block: 17865711, instructions: [] }
  db.chain = lodash.chain(db.data)

  console.log(`last block: ${db.chain.get("block").value()}`)
  await syncNewTips()
  await scanNew()
  await scanHot()
}

function beat(block){
  process.stdout.write(".")
  heartbeat = Date.now()
}

async function syncNewTips(){
  console.log("syncNewTips")
  const pastTips = await tipping.queryFilter("Tip", db.chain.get("block").value()+1)
  console.log(pastTips.length)
  for (let i = 0; i < pastTips.length; i++) {
    await save(pastTips[i])
  }
}

async function save(tip){
  tip = marshalTip(tip)
  console.log(`saving tip for ${tip.contentId} at ${tip.id}`)
  db.data.tips.push(tip)
  db.data.block = tip.blockNumber
  await db.write()
}

function marshalTip({blockNumber, transactionHash, args}){
  return {
    id: transactionHash,
    blockNumber,
    from: args.from,
    to: args.to,
    amount: args.amount.toString(),
    token: args.token,
    contentId: parseBytes32String(args.contentId)
  }
}

async function scanNew(){
  const newPosts = await reddit.getSubreddit("EthTrader").getNew()
  const comedy = newPosts.filter(isComedy)
  const media = newPosts.filter(isMedia)
  const needsInstruction = await Promise.filter(comedy.concat(media), noInstruction)
  console.log(`Scan new complete: ${comedy.length} Comedy, ${media.length} Media, ${needsInstruction.length} need instruction`)
  await Promise.all(needsInstruction.map(addInstruction))
}

async function scanHot(){
  const hotPosts = await reddit.getSubreddit("EthTrader").getHot()
  const comedy = hotPosts.filter(isComedy)
  const cutoffComedy = comedy.filter(isOverCutoff)
  const media = hotPosts.filter(isMedia)
  const cutoffMedia = media.filter(isOverCutoff)
  const cutoff = cutoffComedy.concat(cutoffMedia)
  const cutoffHasInstruction = await Promise.filter(cutoff, getInstructionId)
  const toRemove = cutoffHasInstruction.filter(noQualifiedTip)
  console.log(`Scan hot complete: ${comedy.length} Comedy. ${media.length} Media. ${cutoff.length} over cutoff, ${toRemove.length} to remove`)
  const removed = await Promise.all(toRemove.map(remove))
}

function getTips(post){
  let tips = db.chain.get('tips').filter({ contentId: post.name }).value()
  return tips
}

function noQualifiedTip(post){
  let tips = getTips(post)
  if(!tips.length) return true
  // is tipper registered and not same as author
  tips = tips.filter((t)=>{
    const user = users.find((u)=>u.address.toLowerCase()===t.from.toLowerCase())
    return user && user.username !== (post.author && post.author.name)
  })
  return !tips.length
}

function isOverCutoff(post){
  const now = dayjs.utc()
  const cutoff = dayjs.utc(post.created_utc*1000).add(GRACE_HRS, 'h')
  const isCutoff = dayjs.utc(post.created_utc*1000).add(GRACE_HRS, 'h').isBefore(now)
  return isCutoff
}

function isComedy(post){
  if(post.link_flair_template_id === COMEDY_FLAIR_ID) {
    if(post.link_flair_text && post.link_flair_text.toLowerCase()==="comedy")
      return true
    handleBadFlair(post)
  }
  if(post.link_flair_text && post.link_flair_text.toLowerCase()==="comedy"){
    if(!post.link_flair_template_id)
      return true
    handleBadFlair(post)
  }
  return false
}

function isMedia(post){
  if(post.link_flair_template_id === MEDIA_FLAIR_ID) {
    if(post.link_flair_text && post.link_flair_text.toLowerCase()==="media")
      return true
    handleBadFlair(post)
  }
  if(post.link_flair_text && post.link_flair_text.toLowerCase()==="media"){
    if(!post.link_flair_template_id)
      return true
    handleBadFlair(post)
  }
  return false
}

async function addInstruction(post){
  const cutoffUTC = dayjs.utc(post.created_utc*1000).add(GRACE_HRS, 'h')
  let message = `[Tip this post any amount of $DONUTs within ${GRACE_HRS}hrs](https://www.donut.finance/tip/?contentId=${post.name}) (by [${cutoffUTC.format("h:mma")} utc](https://www.donut.finance/time?utc=${cutoffUTC.format()})) to keep it visible.`
  try {
    const reply = await post.reply(message)
    console.log(`added instruction to http://old.reddit.com${post.permalink}`)
    db.data.instructions.push({postId: post.id, commentId: reply.id})
    await db.write()
    await reply.distinguish({status: true, sticky: true})
  } catch(e){
    console.log(`error posting instruction for http://old.reddit.com${post.permalink}`)
  }
}

async function remove(post){
  try {
    await post.remove()
    console.log(`removed https://old.reddit.com${post.permalink}`)
  } catch(e){
    console.log(`error removing http://old.reddit.com${post.permalink}`)
  }
}

async function getInstructionId(post){
  const instruction = await db.chain.get("instructions").find({ postId: post.id }).value()
  // console.log("getInstructionId", instruction)
  return instruction ? instruction.commentId : null
  // try {
  //   post = await post.expandReplies()
  //   return post.comments.find(r=>r.author.name==="EthTraderCommunity")
  // } catch(e){
  //   console.log(`error expanding replies`)
  // }
}

async function noInstruction(post){
  return !(await getInstructionId(post))
}

async function handleBadFlair(post){
  console.log(`http://old.reddit.com${post.permalink} has bad flair`)
}
