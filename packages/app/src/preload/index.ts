import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('axi', { ping: () => 'pong' })
