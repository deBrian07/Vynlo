/** Synthetic markup based on documented private Gmail structures. No captured messages. */
export const THREAD_A = '18b123456789abcd';
export const THREAD_B = '18b123456789abce';
export function gmailFixture(email = 'person@example.com', thread = THREAD_A): string {
  return `<header role="banner"><a aria-label="Google Account: Example (${email})" href="https://accounts.google.com/SignOutOptions">Account</a></header>
    <main role="main" style="background-color: rgb(255, 255, 255)"><div gh="mtb" role="toolbar"></div>
    <h2 data-thread-perm-id="thread-f:1780000000000000000" data-legacy-thread-id="${thread}">Project check-in</h2>
    <div role="textbox" contenteditable="true" g_editable="true" tabindex="0">Existing draft</div></main>`;
}
