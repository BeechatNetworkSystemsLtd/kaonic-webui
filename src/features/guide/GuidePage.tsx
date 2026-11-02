import { Page } from '@/shell/Page';
import { GuideContent } from './GuideContent';

/** The guide inside the signed-in app. */
export default function GuidePage() {
  return (
    <Page title="Guide" description="How a Kaonic network works, how nodes are paired, and how to use each page.">
      <GuideContent />
    </Page>
  );
}
