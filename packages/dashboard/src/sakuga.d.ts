import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type SakugaProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  variant?: string;
  type?: string;
  name?: string;
  label?: string;
  checked?: boolean | '';
  duration?: number;
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'sakuga-button': SakugaProps;
      'sakuga-checkbox': SakugaProps;
      'sakuga-toast': SakugaProps;
      'sakuga-progress': SakugaProps;
    }
  }
}
