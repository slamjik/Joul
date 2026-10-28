import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { apiApp } from './server/api.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use('/api', apiApp)
app.use(express.static(path.join(__dirname, 'dist')))
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`)
})
