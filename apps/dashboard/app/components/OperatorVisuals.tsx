export function OperatorIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    chevron: "m7 3 10 9-10 9",
    clipboard: "M8 4H5a2 2 0 0 0-2 2v16h19V6a2 2 0 0 0-2-2h-3M8 4V2h8v4H8V4ZM8 11h9m-9 5h7",
    edit: "m16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5",
    search: "M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-2 6 7 7",
    store:
      "M3 9h18l-2-6H5L3 9Zm1 0v12h16V9M9 21v-8h6v8M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0",
    clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v7l4 2",
    layers: "m12 2 11 6-11 6L1 8l11-6ZM2 13l10 6 10-6M2 18l10 6 10-6",
    delivery:
      "M9 20a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm16 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0M6 17h10l4-7-2-7h4l3 14M4 7h7v4H5l-2 6M11 11l3 6M1 11h2M0 15h2",
    calendar:
      "M3 5h20v17H3V5ZM8 2v6M18 2v6M3 11h20M8 15h.2m4.8 0h.2m4.8 0h.2M8 19h.2m4.8 0h.2m4.8 0h.2",
    user: "M17 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM3 23v-3a10 7 0 0 1 20 0v3H3Z",
    document: "M5 2h11l5 5v16H5V2Zm11 0v6h5M9 12h8m-8 5h8",
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
      data-icon={name}
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
