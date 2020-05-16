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

const postToWebhook = ({ creator, title, url, content, timestamp, fullTitle, images = [], imageCount = 0 }) => {
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
  if (images.length > 0) {
    let image = images.shift()
    embed.image = { url: image }
    if (imageCount !== 0) {
      options.content = `Image \`#${imageCount + 1}\`.`
      delete embed.description
    }
  }
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
    if (imageCount === 0) fs.writeFile('lastpost', lastpost, () => {})
    let resText = `[${res.status}]`
    let imageCountText = imageCount > 0 ? ` (image #${imageCount + 1})` : ``
    if (res.ok) console.log(`${resText} Posted "${title}"${imageCountText} successfully!`)
    else console.log(`${resText} Could not post "${title}"${imageCountText}: ${res.statusText}`)
    if (images.length > 0) postToWebhook({ creator, title, url, content, timestamp, fullTitle, images, imageCount: imageCount + 1 })
  })
}


const getNextItem = items => {
  let item
  for (let i = items.length -1; i >= 0; i--) {
    let date = new Date(items[i].isoDate).toISOString()
    if (date > lastpost) {
      item = items[i]
      console.log(`Attempting to post "${item.title}" (${new Date(item.isoDate).toISOString()}) ...`)
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
    $('a').each((index, element) => {
      let elem = $(element)
      // console.log(`Testing a ${index} - ${elem.attr('href')} - ${elem.text()}`)
      if (elem.text().match(/(Next|Prev(ious)?)\s+Chapter/)) return
      elem.text(
        `**[${elem.text().replace(/^[\[\]\(\)]*|[\[\]\(\)]*$/, '').trim()}]` +
        `(${elem.attr('href')})**`
      )
    })

    let content = $.text()
    if (process.env.TRIM_REGEX) content = content.replace(new RegExp(process.env.TRIM_REGEX, 's'), '').trim()
    content = content.substr(0, 800 - url.length).trim().split(' ')
    let lastElement = content.pop()
    content = content.join(' ').replace(/\n+/g, '\n\n')

    let asterisks = content.match(/\*/g) || []
    if (asterisks.length % 2 !== 0) content = `${content.trim()}*`
    
    let imageElements = $('img').map((index, element) => {
      let image = $(element)
      if (image.attr('srcset')) return image.attr('srcset').replace(/\s+(\d+[\w,]+)/g, '').split(/\s+/).pop()
      else return image.attr('src')
    })
    let images = Array.from(imageElements)
    // console.log(images)
    
    postToWebhook({ creator, title, url, content, timestamp, fullTitle, images })
  })
}

checkFeed()
setInterval(checkFeed, process.env.INTERVAL || 60 * 1000)