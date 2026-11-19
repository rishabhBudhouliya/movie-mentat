import type { ReactNode } from "react";

/**
 * Reusable inline error block: a title, a message, and an optional action
 * (typically a Retry button). Rendered wherever a state's `error` variant
 * needs to be surfaced, so error styling stays consistent across the app.
 */
export function ErrorNotice({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-left dark:border-red-900/40 dark:bg-red-950/30"
    >
      <div className="flex items-start gap-3">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-red-500 dark:text-red-400"
        >
          <path
            fill="currentColor"
            d="M12 2 1 21h22L12 2Zm0 6.5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0v-5a1 1 0 0 1 1-1ZM12 17a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z"
          />
        </svg>
        <div className="flex flex-col gap-1">
          <p className="font-medium text-red-900 dark:text-red-100">{title}</p>
          <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
        </div>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
