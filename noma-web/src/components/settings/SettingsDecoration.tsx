export function SettingsDecoration() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-0 right-0 select-none overflow-hidden"
    >
      <svg
        width="320"
        height="280"
        viewBox="0 0 320 280"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="opacity-[0.35]"
      >
        <path
          d="M248 248C248 200 280 168 312 148"
          stroke="#B8D4CB"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M200 260C200 210 230 170 268 148"
          stroke="#C5DDD4"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <ellipse cx="248" cy="248" rx="8" ry="12" fill="#D4E8E0" />
        <ellipse cx="220" cy="230" rx="6" ry="10" fill="#D4E8E0" />
        <ellipse cx="268" cy="200" rx="7" ry="11" fill="#C5DDD4" />
        <path
          d="M180 270 Q200 220 230 190 Q250 170 280 160"
          stroke="#B8D4CB"
          strokeWidth="1.5"
          fill="none"
        />
        <circle cx="290" cy="155" r="4" fill="#B8D4CB" />
        <circle cx="275" cy="175" r="3" fill="#C5DDD4" />
        <circle cx="255" cy="195" r="3.5" fill="#D4E8E0" />
      </svg>
    </div>
  );
}
