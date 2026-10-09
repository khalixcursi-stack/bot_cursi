function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function prune(timestamps, since) {
  while (timestamps.length && timestamps[0] <= since) timestamps.shift()
}

export class SafetyController {
  constructor(settings, logger) {
    this.settings = settings
    this.policy = {
      allowPublicMode: Boolean(settings.allowPublicMode),
      allowGroupAutomation: Boolean(settings.allowGroupAutomation),
      allowStatusAutomation: Boolean(settings.allowStatusAutomation)
    }
    this.logger = logger
    this.outgoingQueue = Promise.resolve()
    this.queueDepth = 0
    this.globalOutgoing = []
    this.chatOutgoing = new Map()
    this.commandUsers = new Map()
    this.commandChats = new Map()
    this.commandBlocks = new Map()
    this.lastGlobalSend = 0
    this.lastChatSend = new Map()
    this.dailyKey = this.currentDay()
    this.dailyOutgoing = 0
    this.dailyStatusActions = 0
  }

  currentDay() {
    return new Date().toISOString().slice(0, 10)
  }

  resetDailyIfNeeded() {
    const day = this.currentDay()
    if (day === this.dailyKey) return
    this.dailyKey = day
    this.dailyOutgoing = 0
    this.dailyStatusActions = 0
  }

  registerWindow(map, key, limit, now) {
    const timestamps = map.get(key) || []
    prune(timestamps, now - 60_000)
    const allowed = timestamps.length < limit
    if (allowed) timestamps.push(now)
    map.set(key, timestamps)
    return allowed
  }

  admitCommand({ sender, chat }) {
    if (!this.settings.enabled) return { allowed: true, notify: false, retryAfter: 0 }
    const now = Date.now()
    const identity = sender || 'unknown'
    const block = this.commandBlocks.get(identity)
    if (block && block.until > now) {
      const notify = !block.notified
      block.notified = true
      return { allowed: false, notify, retryAfter: Math.ceil((block.until - now) / 1000) }
    }
    if (block) this.commandBlocks.delete(identity)

    const userAllowed = this.registerWindow(this.commandUsers, identity, this.settings.commandsPerUserMinute, now)
    const chatAllowed = this.registerWindow(this.commandChats, chat || 'unknown', this.settings.commandsPerChatMinute, now)
    if (userAllowed && chatAllowed) return { allowed: true, notify: false, retryAfter: 0 }

    const until = now + this.settings.commandBlockSeconds * 1000
    this.commandBlocks.set(identity, { until, notified: true })
    return { allowed: false, notify: true, retryAfter: this.settings.commandBlockSeconds }
  }

  setPolicy(name, value) {
    if (!(name in this.policy)) throw new Error(`Politique de sécurité inconnue : ${name}`)
    this.policy[name] = Boolean(value)
    return this.policy[name]
  }

  policyAllowed(name) {
    return Boolean(this.policy[name])
  }

  consumeStatusAction() {
    if (!this.settings.enabled) return true
    this.resetDailyIfNeeded()
    if (!this.policy.allowStatusAutomation) return false
    if (this.dailyStatusActions >= this.settings.statusActionsPerDay) return false
    this.dailyStatusActions += 1
    return true
  }

  async waitForOutgoingSlot(chat) {
    while (true) {
      this.resetDailyIfNeeded()
      if (this.dailyOutgoing >= this.settings.outgoingPerDay) {
        throw new Error('Limite quotidienne de sécurité atteinte. Aucun autre message automatique ne sera envoyé aujourd’hui.')
      }

      const now = Date.now()
      const globalWindow = this.globalOutgoing
      const chatWindow = this.chatOutgoing.get(chat) || []
      prune(globalWindow, now - 60_000)
      prune(chatWindow, now - 60_000)
      this.chatOutgoing.set(chat, chatWindow)

      let wait = Math.max(
        0,
        this.lastGlobalSend + this.settings.outgoingMinIntervalMs - now,
        (this.lastChatSend.get(chat) || 0) + this.settings.outgoingChatIntervalMs - now
      )
      if (globalWindow.length >= this.settings.outgoingPerMinute) {
        wait = Math.max(wait, globalWindow[0] + 60_000 - now)
      }
      if (chatWindow.length >= this.settings.outgoingPerChatMinute) {
        wait = Math.max(wait, chatWindow[0] + 60_000 - now)
      }
      if (wait <= 0) return
      await sleep(Math.min(wait + 25, 60_000))
    }
  }

  recordOutgoing(chat) {
    const now = Date.now()
    this.resetDailyIfNeeded()
    this.globalOutgoing.push(now)
    const chatWindow = this.chatOutgoing.get(chat) || []
    chatWindow.push(now)
    this.chatOutgoing.set(chat, chatWindow)
    this.lastGlobalSend = now
    this.lastChatSend.set(chat, now)
    this.dailyOutgoing += 1
  }

  send(rawSend, chat, content, options) {
    if (!this.settings.enabled) return rawSend(chat, content, options)
    if (this.queueDepth >= this.settings.maxOutgoingQueue) {
      return Promise.reject(new Error('File d’envoi saturée par la protection anti-spam.'))
    }

    this.queueDepth += 1
    const task = this.outgoingQueue
      .catch(() => {})
      .then(async () => {
        await this.waitForOutgoingSlot(chat)
        const result = await rawSend(chat, content, options)
        this.recordOutgoing(chat)
        return result
      })
      .finally(() => { this.queueDepth -= 1 })
    this.outgoingQueue = task
    return task
  }

  protectSocket(sock) {
    const rawSend = sock.sendMessage.bind(sock)
    sock.sendMessage = (chat, content, options) => this.send(rawSend, chat, content, options)
    return sock
  }

  snapshot() {
    this.resetDailyIfNeeded()
    return {
      enabled: this.settings.enabled,
      dailyOutgoing: this.dailyOutgoing,
      outgoingPerDay: this.settings.outgoingPerDay,
      queueDepth: this.queueDepth,
      publicModeAllowed: this.policy.allowPublicMode,
      groupAutomationAllowed: this.policy.allowGroupAutomation,
      statusAutomationAllowed: this.policy.allowStatusAutomation,
      commandsPerUserMinute: this.settings.commandsPerUserMinute,
      commandsPerChatMinute: this.settings.commandsPerChatMinute,
      outgoingPerMinute: this.settings.outgoingPerMinute,
      outgoingPerChatMinute: this.settings.outgoingPerChatMinute
    }
  }
}
