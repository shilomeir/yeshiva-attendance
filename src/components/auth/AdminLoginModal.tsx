import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/store/authStore'

interface AdminLoginModalProps {
  open: boolean
  onClose: () => void
}

export function AdminLoginModal({ open, onClose }: AdminLoginModalProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { loginAdmin } = useAuthStore()
  const navigate = useNavigate()h

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin) return

    setIsLoading(true)
    setError('')

    // Simulate small delay
    await new Promise((resolve) => setTimeout(resolve, 500))
