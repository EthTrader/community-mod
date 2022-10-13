import { ethers } from 'ethers'
const { BigNumber, utils, constants, providers, Contract } = ethers
const { formatUnits, Fragment, Interface, parseBytes32String } = utils
import Promise from "bluebird"
import fetch from "node-fetch"
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import snoowrap from "snoowrap"
import lodash from "lodash"
import { LowSync, JSONFileSync } from "lowdb"
import { TippingABI, ERC20ABI } from './abis/index.js';
dayjs.extend(utc)
fetch.Promise = Promise

let graceHrs = {
  comedy: process.env.GRACE_HRS,
  media: process.env.GRACE_HRS
}

async function getUsers(){
  return await fetch("https://ethtrader.github.io/donut.distribution/users.json").then(res=>res.json())
}

function setupContracts(){
  const xdai = new providers.JsonRpcProvider(process.env.JSON_RPC_PROVIDER_XDAI)
  const tipping = new Contract(process.env.TIPPING_ADDRESS_XDAI, TippingABI, xdai)
  return { tipping }
}

function setupReddit(){
  return new snoowrap({
    userAgent: process.env.USER_AGENT,
    clientId: process.env.REDDIT_SCRIPT_CLIENT_ID,
    clientSecret: process.env.REDDIT_SCRIPT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
  })
}

async function setupDb(){
  const adapter = new JSONFileSync("db.json")
  const db = new LowSync(adapter)
  await db.read()
  db.data = db.data || { tips: [], block: 17865711, instructions: [] }
  db.chain = lodash.chain(db.data)
  return db
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

async function formatAmount(tokenAddress, amount){
  const xdai = new providers.JsonRpcProvider(process.env.JSON_RPC_PROVIDER_XDAI)
  const token = new Contract(tokenAddress, ERC20ABI, xdai)
  const symbol = await token.symbol()
  const decimals = await token.decimals()
  return `${formatUnits(amount, decimals).toString()} ${symbol}`
}

function isComedy(post){
  if(post.link_flair_text && post.link_flair_text.toLowerCase()==="comedy"){
    if(!post.link_flair_template_id || post.link_flair_template_id === process.env.COMEDY_FLAIR_ID)
      return true
    badFlair(post)
  }
  return false
}

function isMedia(post){
  if(post.link_flair_text && post.link_flair_text.toLowerCase()==="media"){
    if(!post.link_flair_template_id || post.link_flair_template_id === process.env.MEDIA_FLAIR_ID)
      return true
    badFlair(post)
  }
  return false
}

async function badFlair(post){
  console.log(`http://old.reddit.com${post.permalink} has bad flair`)
}

function onePostOnly(post){
  const periodEnd = dayjs.utc(post.created_utc*1000)
  const periodStart = dayjs.utc(post.created_utc*1000).subtract(24, 'h')
  return
}

function isOverCutoff(post){
  const now = dayjs.utc()
  const graceHrs = getGraceHrs(post)
  const cutoff = dayjs.utc(post.created_utc*1000).add(graceHrs, 'h')
  const isCutoff = dayjs.utc(post.created_utc*1000).add(graceHrs, 'h').isBefore(now)
  return isCutoff
}

function instructionMessage(post){
  let message = `[Tip this post](https://www.donut.finance/tip/?contentId=${post.name}).`
  if(isComedy(post) || isMedia(post)){
    const graceHrs = getGraceHrs(post)
    const cutoffUTC = dayjs.utc(post.created_utc*1000).add(graceHrs, 'h')
    message = `[Tip this post any amount of $DONUTs within ${graceHrs}hrs](https://www.donut.finance/tip/?contentId=${post.name}) (by [${cutoffUTC.format("h:mma")} utc](https://www.donut.finance/time?utc=${cutoffUTC.format()})) to keep it visible.`
  }
  return message
}

function getGraceHrs(post){
  if(isComedy(post)) return graceHrs["comedy"]
  if(isMedia(post)) return graceHrs["media"]
}

function updateGraceHrs(posts, type){
  console.log(posts.length)
  let oldGraceHrs = graceHrs[type]
  let newGraceHrs = 5 - posts.length
  if(newGraceHrs < 1) newGraceHrs = 1
  console.log(`change ${type} graceHrs from ${oldGraceHrs} to ${newGraceHrs}`)
  graceHrs[type] = newGraceHrs
  return graceHrs[type] !== oldGraceHrs
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export { wait, getUsers, setupContracts, setupReddit, setupDb, marshalTip, formatAmount, badFlair, isComedy, isMedia, isOverCutoff, instructionMessage, updateGraceHrs, onePostOnly }
