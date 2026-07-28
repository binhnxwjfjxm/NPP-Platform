import BusinessLanguageBoundary from '../components/business-language-boundary';
import DocumentNumberingWorkspace from './document-numbering-workspace';

export const dynamic = 'force-dynamic';

export default function DocumentNumberingPage() {
  return (
    <BusinessLanguageBoundary scope="document-numbering">
      <DocumentNumberingWorkspace />
    </BusinessLanguageBoundary>
  );
}
