/**
 * The app's front door is the sign-in page: app.khloe.io opens straight onto
 * it, without "/admin" in the address. What khloe is, and how it uses Google
 * Calendar, is explained on the website (khloe.io) and the privacy page,
 * which is why Google's consent screen points at khloe.io as its homepage —
 * a sign-in form alone would fail Google's branding review.
 *
 * /admin/login still works: next.config.ts forwards it here.
 */
export { default } from './admin/login/page';
