'use client';

import { useRef, useState } from 'react';
import { adminFetchJson } from '@/lib/admin-fetch';
import { BRAND_PRESETS, DEFAULT_BRAND, brandRefusal, checkBrandColour } from '@/lib/brand-colour';
import { Nameplate } from '@/components/booking/Nameplate';
import { Lamp } from '@/components/admin/Instruments';

export interface Branding {
  logoUrl: string | null;
  accentColor: string | null;
  nameBesideLogo: boolean;
}

/**
 * How the booking page looks: the business's logo, whether its name shows
 * beside it, and its colour. The colour takes Mineral's one job on a
 * client's screen — where they are, and the main key — so it is checked
 * against the same rule the page applies (brand-colour.ts) before it can be
 * saved, and the preview beside it is drawn with the page's own nameplate.
 */
export function BookingPageCard({
  slug,
  businessName,
  saved,
  onSaved,
}: {
  slug: string;
  businessName: string;
  saved: Branding;
  onSaved: () => Promise<void>;
}) {
  const [colour, setColour] = useState(saved.accentColor ?? DEFAULT_BRAND);
  const [custom, setCustom] = useState(saved.accentColor ?? '');
  const [nameBeside, setNameBeside] = useState(saved.nameBesideLogo);
  const [busy, setBusy] = useState<null | 'save' | 'upload' | 'remove'>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const check = checkBrandColour(colour);
  const savedColour = saved.accentColor ?? DEFAULT_BRAND;
  const dirty = colour.toLowerCase() !== savedColour.toLowerCase() || nameBeside !== saved.nameBesideLogo;
  const shown = check.ok ? check.hex : DEFAULT_BRAND;

  async function run(kind: 'save' | 'upload' | 'remove', request: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    setDone(false);
    try {
      await request();
      await onSaved();
      setDone(kind === 'save');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!check.ok) return;
    void run('save', () =>
      adminFetchJson(`/api/admin/${slug}/branding`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accentColor: check.hex === DEFAULT_BRAND ? null : check.hex,
          nameBesideLogo: nameBeside,
        }),
      }),
    );
  }

  function upload(file: File) {
    const form = new FormData();
    form.append('logo', file);
    void run('upload', () => adminFetchJson(`/api/admin/${slug}/branding`, { method: 'POST', body: form }));
  }

  return (
    <form className="card acct-card" onSubmit={save}>
      <div className="admin-card-title">Your booking page</div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      <div className="bp">
        <div className="bp-settings">
          <div className="field">
            <span className="bp-label">Logo</span>
            <div className="bp-logo-row">
              <div className="bp-logo-well">
                {saved.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the business's own file
                  <img src={saved.logoUrl} alt="Your logo" />
                ) : (
                  <span>No logo yet</span>
                )}
              </div>
              <input
                ref={fileInput}
                id="bp-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={busy !== null}
                onClick={() => fileInput.current?.click()}
              >
                {busy === 'upload' ? 'Uploading…' : saved.logoUrl ? 'Replace' : 'Upload a logo'}
              </button>
              {saved.logoUrl && (
                <button
                  type="button"
                  className="btn-link"
                  disabled={busy !== null}
                  onClick={() =>
                    void run('remove', () => adminFetchJson(`/api/admin/${slug}/branding`, { method: 'DELETE' }))
                  }
                >
                  {busy === 'remove' ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
            <p className="field-note">
              PNG, JPG or WebP, up to 1 MB. Shown 40px high at the top of your page. Without one, your
              business name is shown there instead.
            </p>
          </div>

          {saved.logoUrl && (
            <fieldset className="field bp-fieldset">
              <legend className="bp-label">Beside the logo</legend>
              <div className="bp-switch">
                <label className={!nameBeside ? 'is-on' : ''}>
                  <input type="radio" name="bp-beside" checked={!nameBeside} onChange={() => setNameBeside(false)} />
                  Nothing — it has my name
                </label>
                <label className={nameBeside ? 'is-on' : ''}>
                  <input type="radio" name="bp-beside" checked={nameBeside} onChange={() => setNameBeside(true)} />
                  My business name
                </label>
              </div>
            </fieldset>
          )}

          <fieldset className="field bp-fieldset">
            <legend className="bp-label">Your colour</legend>
            <div className="bp-swatches">
              {BRAND_PRESETS.map((p) => (
                <label key={p.hex} className="bp-swatch" title={p.label}>
                  <input
                    type="radio"
                    name="bp-colour"
                    checked={colour.toLowerCase() === p.hex}
                    onChange={() => {
                      setColour(p.hex);
                      setCustom('');
                    }}
                  />
                  <span style={{ background: p.hex }} aria-hidden="true" />
                  <span className="sr-only">
                    {p.label}
                    {p.hex === DEFAULT_BRAND ? ', intro’s own' : ''}
                  </span>
                </label>
              ))}
              <label className="bp-custom">
                <span>Your own</span>
                <input
                  type="text"
                  inputMode="text"
                  placeholder="#2E5E7E"
                  maxLength={7}
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    if (e.target.value.trim()) setColour(e.target.value);
                  }}
                />
              </label>
            </div>
            {check.ok ? (
              <p className="bp-readout">
                <Lamp tone="live" />
                {check.contrast} : 1 on white — readable as text and as a button edge.
              </p>
            ) : (
              <p className="bp-readout is-need" role="alert">
                <Lamp tone="need" />
                {brandRefusal(check)}
              </p>
            )}
            <p className="field-note">
              It marks where a client is — the step they are on, the day and time they chose — and your main
              button. Anything that needs fixing is always shown in Ochre, so colours close to it, or too pale to
              read, can’t be chosen.
            </p>
          </fieldset>

          <div className="wk-actions" style={{ marginTop: 0 }}>
            <button type="submit" className="btn-primary" disabled={!dirty || !check.ok || busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            {done && !dirty && <span className="ms-saved">Saved.</span>}
            <a href={`/t/${slug}`} target="_blank" rel="noreferrer" className="bp-open">
              Open your page
            </a>
          </div>
        </div>

        <div className="bp-preview-wrap">
          <p className="wk-side-eyebrow">What a client sees</p>
          <div className="bp-preview bk" aria-hidden="true" style={{ '--accent': shown } as React.CSSProperties}>
            <div className="bp-preview-bar">
              <Nameplate
                name={businessName}
                branding={{ logoUrl: saved.logoUrl, nameBesideLogo: nameBeside }}
              />
            </div>
            <div className="bp-preview-plate">
              <div className="bk-lamps">
                <span className="bk-lamp is-done" />
                <span className="bk-lamp is-here" />
                <span className="bk-lamp" />
                <span className="bk-lamp" />
              </div>
              <b>Choose a time</b>
              <div className="bp-preview-slots">
                <span>09:30</span>
                <span className="is-on">10:30</span>
                <span>11:30</span>
              </div>
              <span className="bp-preview-key">Continue</span>
            </div>
          </div>
          <p className="wk-side-hint">
            The same inside your own website, without the bar at the top — your site already says who you are.
          </p>
        </div>
      </div>
    </form>
  );
}
