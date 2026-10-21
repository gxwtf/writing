import { NotebookDetailPageContent } from '@/components/NotebookDetailPageContent';

export const metadata = {
  title: '积累本',
};

export default function NotebookPage({ params }: { params: Promise<{ id: string }> }) {
  return <NotebookDetailPageContent params={params} />;
}
