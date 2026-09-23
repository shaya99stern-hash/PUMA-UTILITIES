export default function PumaBrandMark({ size = 28 }: { size?: number }) {
  return (
    <span className="pm-brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="18" r="15.2" fill="rgba(16,18,20,0.58)" stroke="#86aeb6" strokeWidth="1.1" />
        <circle cx="18" cy="18" r="10.6" stroke="#c7e0e5" strokeWidth="1.35" />
        <path d="M11.6 20.5a6.8 6.8 0 0 1 12.8 0" stroke="#c7e0e5" strokeWidth="1.35" strokeLinecap="round" />
        <path d="M18 18l4.5-4.2" stroke="#c7e0e5" strokeWidth="1.35" strokeLinecap="round" />
        <circle cx="18" cy="18" r="1.45" fill="#86aeb6" />
        <path d="M18 7.4c-1.5 2.2-2.6 3.7-2.6 5.1a2.6 2.6 0 0 0 5.2 0c0-1.4-1.1-2.9-2.6-5.1Z" stroke="#c7e0e5" strokeWidth="1.35" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
