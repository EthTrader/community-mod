const { ethers } = require("ethers")
const { BigNumber, utils, constants, providers, Contract } = ethers
const { formatUnits, Fragment, Interface, parseBytes32String } = utils
const snoowrap = require("snoowrap")
const Promise = require("bluebird")
const dayjs = require('dayjs')
dayjs.extend(require('dayjs/plugin/utc'))
const low = require("lowdb")
const FileAsync = require("lowdb/adapters/FileAsync")
const TippingABI = require("./abis/Tipping.json")
const ERC20ABI = require("./abis/ERC20.json")
const COMEDY_FLAIR_ID = "fd58a15c-e93f-11e5-a0f2-0e293b108187"
const MINUTES_1 = 1*60*1000
const MINUTES_5 = 5*60*1000
const MINUTES_10 = 10*60*1000
const GRACE_HRS = 6
const adapter = new FileAsync("db.json")

const reddit = new snoowrap({
  userAgent: "EthTrader tipping 1.0 by u/EthTraderCommunity",
  clientId: process.env.REDDIT_SCRIPT_CLIENT_ID,
  clientSecret: process.env.REDDIT_SCRIPT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD
})
const xdai = new providers.WebSocketProvider(process.env.WSS_PROVIDER_XDAI)
const mainnet = new providers.WebSocketProvider(process.env.WSS_PROVIDER_MAINNET)

const tipping = new Contract(process.env.TIPPING_ADDRESS_XDAI, TippingABI, xdai)
let db, heartbeat

main()

async function main(){
  db = (await low(adapter)).defaults({ tips: [], block: 14745448, instructions: [] })
  console.log(`last block: ${db.get("block").value()}`)
  await syncNewTips()
  await scanNew()
  await scanHot()
  // setTimeout(process.exit, MINUTES_5)
  // setInterval(syncNewTips, MINUTES_10)
  // setInterval(scanNew, MINUTES_1)
  // setInterval(scanHot, MINUTES_10)
}

function beat(block){
  process.stdout.write(".")
  heartbeat = Date.now()
}

async function syncNewTips(){
  console.log("syncNewTips")
  const pastTips = await tipping.queryFilter("Tip", db.get("block").value()+1)
  console.log(pastTips.length)
  for (let i = 0; i < pastTips.length; i++) {
    await save(pastTips[i])
  }
}

async function save(tip){
  tip = marshalTip(tip)
  console.log(`saving tip for ${tip.contentId} at ${tip.id}`)
  await db.get("tips").push(tip).write()
  await db.set("block", tip.blockNumber).write()
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
  const needsInstruction = await Promise.filter(comedy, noInstruction)
  console.log(`Scan new complete: ${comedy.length} Comedy posts, ${needsInstruction.length} need instructional comment`)
  await Promise.all(needsInstruction.map(addInstruction))
}

async function scanHot(){
  const hotPosts = await reddit.getSubreddit("EthTrader").getHot()
  const comedy = hotPosts.filter(isComedy)
  const cutoff = comedy.filter(isOverCutoff)
  const cutoffHasInstruction = await Promise.filter(cutoff, getInstructionId)
  const toRemove = cutoffHasInstruction.filter(noTip)
  // const toRemove = cutoff.filter(noTip)
  console.log(`Scan hot complete: ${comedy.length} Comedy posts. ${cutoff.length} over cutoff, ${toRemove.length} to remove`)
  const removed = await Promise.all(toRemove.map(remove))
}

function getTips(post){
  let tips = db.get('tips').filter({ contentId: post.name }).value()
  return tips
}

function noTip(post){
  return !getTips(post).length
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
    await db.get("instructions").push({postId: post.id, commentId: reply.id}).write()
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
  const instruction = await db.get("instructions").find({ postId: post.id }).value()
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
  console.log(`${post.id} has bad flair`)
}
