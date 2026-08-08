# Video URL import pending-state plan

1. Make the URL-import client accept an `AbortSignal` and preserve aborts as a
   distinct, non-error outcome.
2. Add a centered, accessible Video Canvas overlay with a spinner, import
   status, and Cancel action.
3. Start the overlay before URL import, abort and hide it on cancel, and only
   call `setFile` if the current import is still active.
4. Surface server validation failures after the overlay closes; cancellation
   must not show an error.
5. Type-check the frontend and manually verify the pending, cancel, success,
   and error transitions.
