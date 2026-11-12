// Sends Events to Flock with plain fetch (stands in for the browser script until it exists).
const { api, key } = window.FLOCK

export const send = async (events) => {
  const response = await fetch(`${api}/api/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, events })
  })
  return { status: response.status, body: await response.text() }
}

export const pageview = () =>
  send([{ uuid: crypto.randomUUID(), name: "$pageview", properties: { $url: location.href, $referrer: document.referrer } }])

export const showConfig = (el) => {
  el.textContent = `Sending to ${api} with key ${key}`
}
