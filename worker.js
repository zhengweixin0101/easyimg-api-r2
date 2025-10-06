const customDomain = "https://cdn.zhengweixin.top/" // 访问域名
const prefix = "blog/comments/"                     // 上传路径
const TOKEN = "123456"                              // API Token
const RATE_LIMIT_WINDOW = 3600_000                  // 上传限制时间
const RATE_LIMIT_MAX = 5                            // 时间内可上传的次数
// 以上配置自行修改，并绑定KV和R2至该worker
export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 })
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown"
    const limitKey = `upload:${ip}`
    const limitData = await env.KV.get(limitKey, { type: "json" }) || { 
      count: 0, 
      reset: Date.now() + RATE_LIMIT_WINDOW
    }
    
    if (Date.now() > limitData.reset) {
      limitData.count = 0
      limitData.reset = Date.now() + RATE_LIMIT_WINDOW
    }
    
    if (limitData.count >= RATE_LIMIT_MAX) {
      const retryAfter = Math.ceil((limitData.reset - Date.now()) / 1000)
      return new Response(JSON.stringify({
        result: "error",
        code: 429,
        message: `每小时只能上传 ${RATE_LIMIT_MAX} 次, 请稍后再试或自行找床图上传！`
      }), {
        headers: {
          "Content-Type": "application/json",
          "Retry-After": retryAfter.toString()
        },
        status: 429
      })
    }

    limitData.count++
    await env.KV.put(limitKey, JSON.stringify(limitData), { expirationTtl: RATE_LIMIT_WINDOW / 1000 })
    const reqClone = request.clone()
    const formData = await reqClone.formData()
    const file = formData.get("image")
    const token = formData.get("token")

    if (!token || token !== TOKEN) {
      return new Response(JSON.stringify({
        result: "error",
        code: 403,
        message: "无效的上传令牌"
      }), { headers: { "Content-Type": "application/json" }, status: 403 })
    }

    if (!file) {
      return new Response(JSON.stringify({ result: "error", code: 400, message: "没有文件上传" }), {
        headers: { "Content-Type": "application/json" },
        status: 400
      })
    }

    const arrayBuffer = await file.arrayBuffer()
    const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")) : ""
    const timestamp = Date.now()
    const randomId = ('randomUUID' in crypto
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)).map(b => b.toString(16).padStart(2,'0')))
    ).replace(/-/g,'')
    const key = `${prefix}${timestamp}_${randomId}${ext}`

    try {
      await env.R2.put(key, arrayBuffer, { httpMetadata: { contentType: file.type } })
      return new Response(JSON.stringify({
        result: "success",
        code: 200,
        url: `${customDomain}${key}`,
        srcName: file.name,
        thumb: `${customDomain}${key}`,
        del: `${customDomain}del?key=${key}`
      }), {
        headers: { "Content-Type": "application/json" }
      })
    } catch (err) {
      return new Response(JSON.stringify({ result: "error", code: 500, message: err.message }), {
        headers: { "Content-Type": "application/json" },
        status: 500
      })
    }
  }
}
