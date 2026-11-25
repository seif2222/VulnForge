import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import '../vendor/sakuga/button.js';
import '../vendor/sakuga/checkbox.js';
import '../vendor/sakuga/progress.js';
import '../vendor/sakuga/toast.js';

/**
 * Thin React wrappers over the Sakuga VFX web components (MIT, vendored under
 * src/vendor/sakuga). The effects are decoration only: every control keeps its
 * real behaviour and the effect layer is skipped under prefers-reduced-motion by
 * the components themselves. Colours come from the --sk-* mapping in styles.css.
 */

type SakugaElement = HTMLElement & { disabled?: boolean; done?: (seconds?: number) => void };

export function SakugaButton(props: {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly type?: 'button' | 'submit';
  readonly variant?: 'secondary';
  readonly disabled?: boolean;
}) {
  const { children, onClick, type = 'button', variant, disabled = false } = props;
  const ref = useRef<SakugaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.disabled = disabled;
  }, [disabled]);
  useEffect(() => {
    const el = ref.current;
    if (el === null || onClick === undefined) return;
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [onClick]);
  return (
    <sakuga-button ref={ref} type={type} variant={variant}>
      {children}
    </sakuga-button>
  );
}

export function SakugaCheckbox(props: {
  readonly children: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly name?: string;
}) {
  const { children, checked, onChange, disabled = false, name } = props;
  const ref = useRef<HTMLElement & { checked?: boolean; disabled?: boolean }>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.checked = checked;
    el.disabled = disabled;
  }, [checked, disabled]);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const handler = () => onChange(el.checked === true);
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, [onChange]);
  return (
    <sakuga-checkbox ref={ref} name={name} checked={checked ? '' : undefined}>
      {children}
    </sakuga-checkbox>
  );
}

/** Real progress only: `value` is done/total from the engine's progress events. */
export function SakugaProgress(props: { readonly value: number; readonly label: string }) {
  const ref = useRef<HTMLElement & { set?: (value: number) => void }>(null);
  useEffect(() => {
    ref.current?.set?.(Math.min(1, Math.max(0, props.value)));
  }, [props.value]);
  return <sakuga-progress ref={ref} label={props.label} />;
}

/** Fires once each time `token` changes to a non-null value. */
export function SakugaToast(props: { readonly token: string | null; readonly message: string }) {
  const ref = useRef<HTMLElement & { show?: (message?: string) => void }>(null);
  const { token, message } = props;
  useEffect(() => {
    if (token !== null) ref.current?.show?.(message);
  }, [token, message]);
  return (
    <div className="vf-toast">
      <sakuga-toast ref={ref} duration={3.2} />
    </div>
  );
}
