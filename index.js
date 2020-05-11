require('dotenv').config()
const Parser = require('rss-parser')
const fetch = require('node-fetch')
const cheerio = require('cheerio')
const parser = new Parser()
const fs = require('fs')

if (!process.env.FEED || !process.env.WEBHOOK) {
  console.error(`You need to provide URLs for 'FEED' and 'WEBHOOK' in a .env file.`)
  process.exit()
}

if (!process.env.INTERVAL) console.log(`No interval set. Defaulting to 1 minute.`)
let lastpost = fs.readFileSync('lastpost', 'utf8') || new Date().toISOString()

const postToWebhook = ({ creator, title, url, content, timestamp, fullTitle, image }) => {
  let embed = {
    url,
    timestamp,
    title: fullTitle,
    description: (content.length > 0 ? content + ' ...\n' : '') + `**[Continue reading →](${url})**`,
    footer: {
      text: process.env.FOOTER_TEXT || creator
    },
  }
  
  let options = {}
  if (process.env.USERNAME) options.username = process.env.USERNAME
  if (process.env.AVATAR) options.avatar_url = process.env.AVATAR
  if (process.env.CONTENT) options.content = process.env.CONTENT
  if (process.env.FOOTER_ICON) embed.footer.icon_url = process.env.FOOTER_ICON
  if (process.env.COLOR) embed.color = process.env.COLOR
  if (image) embed.image = { url: image }
  
  // console.log(JSON.stringify({ ...options, embeds: [embed] }, null, 4))

  fetch(process.env.WEBHOOK, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ...options, embeds: [embed] })
  })
  .then(res => {
    lastpost = timestamp
    fs.writeFile('lastpost', lastpost, () => {})
    if (res.ok) console.log(`[${res.status}] Posted "${title}" successfully!`)
    else console.log(`[${res.status}] Could not post "${title}": ${res.statusText}`)
  })
}


const getNextItem = items => {
  let item
  for (let i = items.length -1; i >= 0; i--) {
    let date = new Date(items[i].isoDate).toISOString()
    if (date > lastpost) {
      item = items[i]
      console.log(`Attempting to post "${item.title}" ...`)
      break
    }
  }
  return item
}

  
const checkFeed = () => {
  parser.parseURL(process.env.FEED).then(feed => {
    if (!feed.items || feed.items.length === 0) return
    let item = getNextItem(feed.items)
    if (!item) return

    let { creator, title, link: url, ['content:encoded']: raw, isoDate } = item
    let timestamp = new Date(isoDate).toISOString()
    let fullTitle = !process.env.PREPEND ? title :
      (process.env.PREPEND === '{FEEDTITLE}'
        ? `${feed.title} — ${title}`
        : `${process.env.PREPEND} ${title}`)
    
    const $ = cheerio.load(raw.replace(/<(em|i)>\s*|\s*<\/(em|i)>/g, '*'))
    let content = $.text()
    if (process.env.TRIM_REGEX) content = content.replace(new RegExp(process.env.TRIM_REGEX, 's'), '').trim()
    content = content.substr(0, 800 - url.length).trim().split(' ')
    let lastElement = content.pop()
    content = content.join(' ').replace(/\n+/g, '\n\n')

    let asterisks = content.match(/\*/g) || []
    if (asterisks.length % 2 !== 0) content = `${content.trim()}*`
    
    let image = $('img').first()
    if (image.attr('srcset')) image = image.attr('srcset').replace(/\s+(\d+[\w,]+)/g, '').split(/\s+/).pop()
    else image = image.attr('src')
    
    postToWebhook({ creator, title, url, content, timestamp, fullTitle, image })
  })
}

checkFeed()
setInterval(checkFeed, process.env.INTERVAL || 60 * 1000)