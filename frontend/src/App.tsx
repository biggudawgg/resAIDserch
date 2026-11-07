import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { Beliefs } from './pages/Beliefs'
import { DeadEnds } from './pages/DeadEnds'
import { Library } from './pages/Library'
import { MeetingDetail } from './pages/MeetingDetail'
import { Meetings } from './pages/Meetings'
import { NotFound } from './pages/NotFound'
import { Overview } from './pages/Overview'
import { Providers } from './pages/Providers'
import { QuestionDetail } from './pages/QuestionDetail'
import { Research } from './pages/Research'
import { Settings } from './pages/Settings'

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="research" element={<Research />} />
        <Route path="research/:id" element={<QuestionDetail />} />
        <Route path="beliefs" element={<Beliefs />} />
        <Route path="dead-ends" element={<DeadEnds />} />
        <Route path="library" element={<Library />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="meetings/:id" element={<MeetingDetail />} />
        <Route path="providers" element={<Providers />} />
        <Route path="settings" element={<Navigate to="/settings/general" replace />} />
        <Route path="settings/:tab" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
