// ============================================================
// Réelgram — mono label badge that names what the placeholder represents
// Ported from design-reference/project/components.jsx.
// ============================================================

export interface PlaceholderLabelProps {
  text: string;
}

export function PlaceholderLabel({ text }: PlaceholderLabelProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 10.5,
        letterSpacing: 0.3,
        color: 'rgba(255,255,255,0.62)',
        background: 'rgba(0,0,0,0.34)',
        border: '1px solid rgba(255,255,255,0.14)',
        padding: '3px 7px',
        borderRadius: 7,
        backdropFilter: 'blur(4px)',
      }}
    >
      {text}
    </div>
  );
}
