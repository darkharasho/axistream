const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const probeName = process.argv.find(a => /^\d\d-/.test(a)) || '00-env'
const platform = process.platform
const outDir = path.join(__dirname, 'out')
fs.mkdirSync(outDir, { recursive: true })

app.whenReady().then(async () => {
  let result
  try {
    const probe = require(`./probes/${probeName}.js`)
    result = await probe({ platform, os })
    result.ok = result.ok !== false
  } catch (err) {
    result = { ok: false, error: String((err && err.stack) || err) }
  }
  const file = path.join(outDir, `${platform}-${probeName}.json`)
  fs.writeFileSync(file, JSON.stringify(result, null, 2))
  console.log(`[spike] wrote ${file}`)
  console.log(`[spike] result.ok = ${result.ok}`)
  app.quit()
})
