// The sign-in page: email and password and/or the Instance's OIDC issuer, and sign-up (open, or
// through an Invite link).
import type { SignInOptions } from "@flock/shared"
import { useNavigate } from "@tanstack/react-router"
import { type FormEvent, useEffect, useState } from "react"
import { oidcSignIn, signIn, signInOptions, signUp } from "./auth.ts"

export const SignInPage = () => {
  const navigate = useNavigate()
  // An Invite link opens /sign-in?invite=<token>. A refused OIDC sign-in comes back
  // with ?error=<code>&error_description=<message>.
  const [query] = useState(() => new URLSearchParams(window.location.search))
  const invite = query.get("invite") ?? undefined
  const [mode, setMode] = useState<"sign-in" | "sign-up">(invite ? "sign-up" : "sign-in")
  const [error, setError] = useState<string | undefined>(
    () => query.get("error_description") ?? (query.get("error") ? `Sign-in failed (${query.get("error")})` : undefined)
  )
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState<SignInOptions>()
  useEffect(() => {
    // If the options can't be loaded, fall back to the password form.
    signInOptions().then(setOptions, () => setOptions({ password: true, oidc: null }))
  }, [])

  const startOidc = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await oidcSignIn(invite)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get("email"))
    const password = String(form.get("password"))
    setBusy(true)
    setError(undefined)
    try {
      if (mode === "sign-in") await signIn({ email, password })
      else await signUp({ email, password, name: String(form.get("name")), invite })
      await navigate({ to: "/" })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const heading = mode === "sign-in" ? "Sign in" : invite ? "Accept your Invite" : "Sign up"
  const brand = <div className="brand">Flock</div>
  if (!options) return <div className="sign-in"><div>{brand}<h1>{heading}</h1></div></div>
  const oidcButton = options.oidc && (
    <button type="button" className="btn" onClick={startOidc} disabled={busy}>Sign in with {options.oidc.name}</button>
  )
  const errorMessage = error && <p role="alert" className="alert">{error}</p>
  if (!options.password) {
    return (
      <div className="sign-in">
        <div>
          {brand}
          <h1>{invite ? "Accept your Invite" : "Sign in"}</h1>
          {errorMessage}
          {oidcButton}
        </div>
      </div>
    )
  }
  return (
    <div className="sign-in">
      <form onSubmit={submit}>
        {brand}
        <h1>{heading}</h1>
        {oidcButton}
        {oidcButton && <p className="dim">or with email and password:</p>}
        {mode === "sign-up" && <label className="field">Name<input name="name" required autoComplete="name" /></label>}
        <label className="field">Email<input name="email" type="email" required autoComplete="email" /></label>
        <label className="field">
          Password
          <input name="password" type="password" required minLength={8} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} />
        </label>
        {errorMessage}
        <button type="submit" className="btn" disabled={busy}>{mode === "sign-in" ? "Sign in" : "Sign up"}</button>
        <button type="button" className="link" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
          {mode === "sign-in" ? "First time? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  )
}
