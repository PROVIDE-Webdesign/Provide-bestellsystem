export function OperatorIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    bag: "M5 7h14l2 14H3L5 7ZM8 8V5a4 4 0 0 1 8 0v3",
    menu: "M4 2v6m4-6v6M2 2v5a4 4 0 0 0 8 0V2M6 11v11M18 2v20m0-20c-4 4-5 10 0 10",
    history: "M3 3v6h6M3 9a9 9 0 1 1 1 10M12 7v5l3 2",
    settings:
      "M9 2h6l1 3 3-1 3 5-2 3 2 3-3 5-3-1-1 3H9l-1-3-3 1-3-5 2-3-2-3 3-5 3 1 1-3ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    sound: "M11 3 5 8H2v8h3l6 5V3Zm4 5a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14",
    pause: "M8 4v16M16 4v16",
    coins:
      "M16 3c-5 0-8 2-8 4s3 4 8 4 8-2 8-4-3-4-8-4ZM8 7v5c0 2 3 4 8 4s8-2 8-4V7M1 12v5c0 2 3 4 8 4h5M1 12c0-2 3-4 7-4",
    filter: "M3 5h18M6 12h12M9 19h6",
    close: "m5 5 14 14M5 19 19 5",
  };
  return (
    <svg
      viewBox="0 0 26 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] ?? paths.bag} />
    </svg>
  );
}
