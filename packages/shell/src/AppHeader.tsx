import type { ReactNode } from 'react';
import { Header, HeaderGlobalBar, HeaderName, Theme } from '@carbon/react';

export interface AppHeaderProps {
  /** Product name shown where the Carbon HeaderName sits. */
  title: string;
  /** Rendered inside <HeaderGlobalBar> — the app supplies its own buttons. */
  toolbar?: ReactNode;
  /** Optional content between the name and the global bar (status text, counts, ...). */
  children?: ReactNode;
  /** HeaderName link target. Default '#'. */
  href?: string;
}

export function AppHeader({ title, toolbar, children, href = '#' }: AppHeaderProps) {
  return (
    // Header — wrapped in g100 so it stays a dark brand bar in light mode.
    <Theme theme="g100">
      <Header aria-label={title} className="canopy-header">
        <HeaderName href={href} prefix="" className="canopy-header__name">
          {title}
        </HeaderName>
        {children}
        <HeaderGlobalBar>{toolbar}</HeaderGlobalBar>
      </Header>
    </Theme>
  );
}
