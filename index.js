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
const MINUTES_10 = 10*60*1000
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
let db

main()

async function main(){
  db = (await low(adapter)).defaults({ tips: [], block: 14745448 })
  console.log(`last block: ${db.get("block").value()}`)
  await monitor()
  await scanNew()
  await scanHot()
  setInterval(scanNew, MINUTES_1)
  setInterval(scanHot, MINUTES_10)
}

async function monitor(){
  const pastTips = await tipping.queryFilter("Tip", db.get("block").value()+1)
  const tips = pastTips.map(marshalTip)
  if(tips.length) {
    await db.get("tips").push(...tips).write()
    await db.set("block", tips[tips.length-1].blockNumber).write()
  }
  tipping.on("Tip", save)
}

async function save(tip){
  await db.get("tips").push(marshalTip(tip)).write()
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
  console.log(`Scan hot complete: ${comedy.length} Comedy posts` )
  const cutoff = comedy.filter(isOverCutoff)
  console.log(`${cutoff.length} Comedy posts over cutoff` )
  const cutoffHasInstruction = await Promise.filter(comedy, getInstruction)
  const toRemove = cutoffHasInstruction.filter(noTip)
  // const toRemove = cutoff.filter(noTip)
  console.log(`${toRemove.length} Comedy posts to remove`)
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
  const now = dayjs()
  const cutoff = dayjs(post.created_utc*1000).add(3, 'h')
  const isCutoff = dayjs(post.created_utc*1000).add(3, 'h').isBefore(dayjs())
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
  const cutoffUTC = dayjs.utc(post.created_utc*1000).add(3, 'h')
  let message = `[Tip this post](https://www.donut.finance/tip/?contentId=${post.name}) by [${cutoffUTC.format("h:ma")} utc](https://www.donut.finance/time?utc=${cutoffUTC.format()}) to keep it visible.`
  console.log(message)
  try {
    const reply = await post.reply(message)
    console.log(`added instruction to http://old.reddit.com${post.permalink}`)
    await reply.distinguish({status: true, sticky: true})
  } catch(e){
    console.log(e)
  }
}

async function remove(post){
  try {
    await post.remove()
  } catch(e){
    console.log(e)
  }
}

async function getInstruction(post){
  post = await post.expandReplies()
  return post.comments.find(r=>r.author.name==="EthTraderCommunity")
}

async function noInstruction(post){
  return !(await getInstruction(post))
}

async function handleBadFlair(post){
  console.log(`${post.id} has bad flair`)
}
