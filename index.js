import Promise from "bluebird"
import { wait, getUsers, setupReddit, setupDb, setupContracts, marshalTip, formatAmount, badFlair, isComedy, isMedia, isOverCutoff, instructionMessage, updateGraceHrs } from './utils.js'

const { MINUTES_1, MINUTES_5, MINUTES_10 } = process.env

const MAX_CUTOFF_POSTS = 3

const { tipping } = setupContracts()
const reddit = setupReddit()
let db, users

main()

async function main(){
  users = await getUsers()
  db = await setupDb()

  console.log(`last block: ${db.data.block}`)
  await syncTips()
  await scanNew()
  await scanHot()
  setInterval(async ()=>{
    await scanNew()
    await scanHot()
  }, MINUTES_5)
}

async function scanNew(){
  const newPosts = await reddit.getSubreddit("EthTrader").getNew()
  const needsInstruction = await Promise.filter(newPosts, noInstruction)
  console.log(`Scan new complete: ${newPosts.length} new, ${needsInstruction.length} need instruction`)
  await Promise.all(needsInstruction.map(addInstruction))
}

async function scanHot(){
  const hotPosts = await reddit.getSubreddit("EthTrader").getHot()

  const comedy = hotPosts.filter(isComedy)
  let changedComedyHrs = updateGraceHrs(comedy, "comedy")
  if(changedComedyHrs) await Promise.mapSeries(comedy, updateInstruction)
  const toRemoveComedy = comedy.filter(isOverCutoff).map(attachQuadScore).sort(sortByQuadScore).slice(MAX_CUTOFF_POSTS)
  const media = hotPosts.filter(isMedia)
  let changedMediaHrs = updateGraceHrs(media, "media")
  if(changedMediaHrs) await Promise.mapSeries(media, updateInstruction)
  const toRemoveMedia = media.filter(isOverCutoff).map(attachQuadScore).sort(sortByQuadScore).slice(MAX_CUTOFF_POSTS)

  const toRemove = toRemoveComedy.concat(toRemoveMedia)

  // const toRemove = cutoffHasInstruction.filter(noQualifiedTip)
  console.log(`Scan hot complete: ${toRemove.length} to remove`)
  // const removed = await Promise.all(toRemove.map(remove))
  await Promise.mapSeries(toRemove, remove)
}

async function syncTips(){
  console.log("syncing tips")
  const pastTips = await tipping.queryFilter("Tip", db.data.block+1)
  await Promise.all(pastTips.map(saveTip))
  tipping.on("Tip", (from,to,amt,token,cid, ev)=>saveTip(ev))
}

async function saveTip(ev){
  const tip = marshalTip(ev)
  await notify(tip)

  db.data.tips.push(tip)
  db.data.block = tip.blockNumber
  await db.write()
}

function attachQuadScore(post){
  post.quadScore = 0
  let tips = getTips(post)
  let tippers = {}
  tips.forEach(t=>{
    let tipper = users.find(u=>u.address.toLowerCase()===t.from.toLowerCase())
    if(tipper && !tippers[tipper.username] && tipper.username !== (post.author && post.author.name)) {
      tippers[tipper.username] = true
      post.quadScore += Math.sqrt(tipper.weight)
    }
  })
  return post
}

function sortByQuadScore(first, second){
  return second.quadScore - first.quadScore
}

async function notify({id, blockNumber, from, to, amount, token, contentId}){
  let target, message
  switch (contentId.substr(0,3)){
    case "t1_":         // is comment
      target = await reddit.getComment(contentId)
      message = await getMessage(from, amount, id, token)
      break
    case "t3_":         // is post
      target = await reddit.getSubmission(contentId)
      message = await getMessage(from, amount, id, token)
      break
    default:
      let user = users.find(u=>u.address.toLowerCase()===from.toLowerCase())
      if(user){
        message = await getMessage(from, amount, id, token)
        await reddit.composeMessage({to: user.username, subject: "You received a tip!", text: message})
      }
      console.log(`no content id, recipient is ${user ? user.username : "unknown"}`)
      break
  }
  if(target){
    console.log(message)
    await target.reply(message)
  }
}

async function getMessage(from, amount, transactionHash, tokenAddress){
  let sender = `${from.slice(0,8)}...`
  let user = users.find(u=>u.address.toLowerCase()===from.toLowerCase())
  if(user)
    sender = `u/${user.username}`

  let txUrl = `${process.env.BLOCK_EXPLORER_TX_PATH}${transactionHash}`
  return `${sender} [tipped](${txUrl}) you ${await formatAmount(tokenAddress, amount)}!`
}

async function getInstructionId(post){
  const instruction = await db.chain.get("instructions").find({ postId: post.id }).value()
  return instruction ? instruction.commentId : null
}

async function addInstruction(post){
  const message = instructionMessage(post)
  try {
    const reply = await post.reply(message)
    console.log(`added instruction to http://old.reddit.com${post.permalink}`)
    db.data.instructions.push({postId: post.id, commentId: reply.id})
    await db.write()
    await reply.distinguish({status: true, sticky: true})
    // await wait(1000)
  } catch(e){
    console.log(`error posting instruction for http://old.reddit.com${post.permalink}`)
  }
}

async function updateInstruction(post){
  const message = instructionMessage(post)
  let instructionId = await getInstructionId(post)
  try {
    const instruction = await reddit.getComment(instructionId).fetch()
    if(instruction.body !== message){
      await instruction.edit(message)
      console.log(`updated instruction http://old.reddit.com${post.permalink}${instructionId}`)
      await wait(4000)
    }
  } catch(e){
    console.log(`error updating instruction http://old.reddit.com${post.permalink}${instructionId}:\n${e.toString().slice(0, 50)}`)
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

async function noInstruction(post){
  return !(await getInstructionId(post))
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
