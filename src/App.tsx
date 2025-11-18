import { useState, useEffect } from 'react'
import { db } from './firebase'
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore'
import { useAuth } from './AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Search, Filter, X, LogOut } from 'lucide-react'

type TodoStatus = 'not started' | 'in progress' | 'on hold' | 'completed';

interface Todo {
  id: string;
  text: string;
  status: TodoStatus;
  dateCreated: string;
  comment: string;
  order: number;
  tags: string[];
  mentions: string[];
  previousStatus?: TodoStatus;
  userId: string;
}

function App() {
  const { user, loading, signUp, signIn, logout } = useAuth()
  const [todos, setTodos] = useState<Todo[]>([])
  const [inputText, setInputText] = useState('')
  const [filterStatuses, setFilterStatuses] = useState<TodoStatus[]>(['not started', 'in progress', 'on hold', 'completed'])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedMentions, setSelectedMentions] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'status' | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTaskText, setEditingTaskText] = useState('')
  const [isSimpleView, setIsSimpleView] = useState(() => {
    const saved = localStorage.getItem('todoAppSimpleView')
    return saved ? JSON.parse(saved) : false
  })
  const [isMobile, setIsMobile] = useState(() => {
    return window.matchMedia('(max-width: 768px)').matches
  })
  const [selectedTaskIndex, setSelectedTaskIndex] = useState<number>(-1)
  const [showAddTaskModal, setShowAddTaskModal] = useState(false)
  const [showStatusFilter, setShowStatusFilter] = useState(false)
  
  // Auth form state
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  
  // Extract tags (#word) from text
  const extractTags = (text: string): string[] => {
    const tagRegex = /#(\w+)/g
    const matches = text.match(tagRegex)
    if (!matches) return []
    // Remove duplicates and strip # symbol
    return [...new Set(matches.map(tag => tag.substring(1)))]
  }

  // Extract mentions (@word) from text
  // Only match @ when preceded by space or at start of string (to avoid email addresses)
  const extractMentions = (text: string): string[] => {
    const mentionRegex = /(?:^|\s)@(\w+)/g
    const matches = [...text.matchAll(mentionRegex)]
    if (matches.length === 0) return []
    // Remove duplicates and extract the captured group (without @)
    return [...new Set(matches.map(match => match[1]))]
  }

  // Get all unique tags from all todos
  const getAllUniqueTags = (): string[] => {
    const allTags = todos.flatMap(todo => todo.tags || [])
    return [...new Set(allTags)].sort()
  }

  // Get all unique mentions from all todos
  const getAllUniqueMentions = (): string[] => {
    const allMentions = todos.flatMap(todo => todo.mentions || [])
    return [...new Set(allMentions)].sort()
  }

  // Detect mobile device changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  // Close filter dropdown when clicking outside
  useEffect(() => {
    if (!showStatusFilter) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if click is outside the filter button container
      if (!target.closest('.filter-btn-container')) {
        setShowStatusFilter(false)
      }
    }

    // Add slight delay to prevent immediate closing when opening
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showStatusFilter])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for ESC key to close Add Task modal first
      if (e.key === 'Escape' && showAddTaskModal) {
        e.preventDefault()
        setShowAddTaskModal(false)
        return
      }
      
      // Don't handle keyboard shortcuts when editing or on mobile
      if (editingTaskId !== null || isMobile) return
      
      const target = e.target as HTMLElement
      
      // Escape key: blur current element to return to navigation mode
      if (e.key === 'Escape') {
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA') {
          e.preventDefault()
          target.blur()
          return
        }
      }
      
      // For Enter key: only trigger edit mode when not focused on any specific interactive element
      // (i.e., user is navigating with arrow keys)
      if (e.key === 'Enter') {
        // If focused on any input, select, or button, let natural behavior happen
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA') {
          return
        }
        // Only trigger edit mode if navigating with arrow keys (no element focused)
        e.preventDefault()
        if (selectedTaskIndex >= 0) {
          const statusMatch = (todo: Todo) => filterStatuses.length === 0 || filterStatuses.includes(todo.status)
          const currentTodos = todos.filter(statusMatch)
          if (selectedTaskIndex < currentTodos.length) {
            const todo = currentTodos[selectedTaskIndex]
            handleTaskDoubleClick(todo)
          }
        }
        return
      }
      
      // Don't handle arrow keys or space if user is typing in an input/textarea/select
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return
      }

      // Get current filtered/sorted todos
      const statusMatch = (todo: Todo) => filterStatuses.length === 0 || filterStatuses.includes(todo.status)
      const currentTodos = todos.filter(statusMatch)
      
      if (currentTodos.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedTaskIndex(prev => {
            if (prev < currentTodos.length - 1) return prev + 1
            return prev
          })
          break
        
        case 'ArrowUp':
          e.preventDefault()
          setSelectedTaskIndex(prev => {
            if (prev > 0) return prev - 1
            if (prev === -1) return currentTodos.length - 1 // Start from bottom if none selected
            return prev
          })
          break
        
        case ' ':
          e.preventDefault()
          if (selectedTaskIndex >= 0 && selectedTaskIndex < currentTodos.length) {
            const todo = currentTodos[selectedTaskIndex]
            toggleComplete(todo.id, todo.status, todo.previousStatus)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskIndex, editingTaskId, todos, filterStatuses, isMobile, showAddTaskModal])

  // Load todos from Firestore
  useEffect(() => {
    if (!user) {
      setTodos([])
      return
    }

    const q = query(
      collection(db, 'todos'), 
      where('userId', '==', user.uid)
    )
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const todosData: Todo[] = []
      querySnapshot.forEach((doc) => {
        const data = doc.data()
        // Ensure tags and mentions arrays exist (for backward compatibility)
        todosData.push({ 
          id: doc.id, 
          ...data,
          tags: data.tags || [],
          mentions: data.mentions || []
        } as Todo)
      })
      // Sort by order on the client side
      todosData.sort((a, b) => a.order - b.order)
      setTodos(todosData)
    })
    return () => unsubscribe()
  }, [user])

  const addTodo = async () => {
    if (inputText.trim() !== '' && user) {
      const newTodo = {
        text: inputText,
        status: 'not started' as TodoStatus,
        dateCreated: new Date().toISOString().split('T')[0],
        comment: '',
        order: todos.length,
        tags: extractTags(inputText),
        mentions: extractMentions(inputText),
        previousStatus: 'not started' as TodoStatus,
        userId: user.uid
      }
      await addDoc(collection(db, 'todos'), newTodo)
      setInputText('')
    }
  }

  const updateStatus = async (id: string, newStatus: TodoStatus) => {
    const todo = todos.find(t => t.id === id)
    const todoRef = doc(db, 'todos', id)
    
    // Track previous status when changing to completed
    if (newStatus === 'completed' && todo && todo.status !== 'completed') {
      await updateDoc(todoRef, { 
        status: newStatus,
        previousStatus: todo.status 
      })
    } else {
      await updateDoc(todoRef, { status: newStatus })
    }
  }

  const toggleComplete = async (id: string, currentStatus: TodoStatus, previousStatus?: TodoStatus) => {
    const todoRef = doc(db, 'todos', id)
    
    if (currentStatus === 'completed') {
      // Unchecking - restore previous status
      const restoreStatus = previousStatus || 'not started'
      await updateDoc(todoRef, { status: restoreStatus })
    } else {
      // Checking - mark as completed and save current status
      await updateDoc(todoRef, { 
        status: 'completed',
        previousStatus: currentStatus 
      })
    }
  }

  const updateComment = async (id: string, newComment: string) => {
    const todoRef = doc(db, 'todos', id)
    await updateDoc(todoRef, { comment: newComment })
  }

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    
    try {
      if (isSignUp) {
        await signUp(email, password)
      } else {
        await signIn(email, password)
      }
    } catch (error: any) {
      setAuthError(error.message || 'Authentication failed')
    }
  }

  const updateTaskText = async (id: string, newText: string) => {
    const todoRef = doc(db, 'todos', id)
    const newTags = extractTags(newText)
    const newMentions = extractMentions(newText)
    await updateDoc(todoRef, { 
      text: newText,
      tags: newTags,
      mentions: newMentions
    })
  }

  const addTag = async (id: string, tag: string, currentTags: string[]) => {
    // Strip leading # if user typed it
    const cleanTag = tag.trim().replace(/^#+/, '')
    if (cleanTag && !currentTags.includes(cleanTag)) {
      const todoRef = doc(db, 'todos', id)
      await updateDoc(todoRef, { tags: [...currentTags, cleanTag] })
    }
  }

  const removeTag = async (id: string, tag: string, currentTags: string[], taskText: string) => {
    const todoRef = doc(db, 'todos', id)
    const newTags = currentTags.filter(t => t !== tag)
    // Strip # from all instances of #tag in the text, keeping the word
    const newText = taskText.replace(new RegExp(`#${tag}`, 'g'), tag)
    await updateDoc(todoRef, { 
      tags: newTags,
      text: newText
    })
  }

  const addMention = async (id: string, mention: string, currentMentions: string[]) => {
    // Strip leading @ if user typed it
    const cleanMention = mention.trim().replace(/^@+/, '')
    if (cleanMention && !currentMentions.includes(cleanMention)) {
      const todoRef = doc(db, 'todos', id)
      await updateDoc(todoRef, { mentions: [...currentMentions, cleanMention] })
    }
  }

  const removeMention = async (id: string, mention: string, currentMentions: string[], taskText: string) => {
    const todoRef = doc(db, 'todos', id)
    const newMentions = currentMentions.filter(m => m !== mention)
    // Strip @ from all instances of @mention in the text, keeping the word
    const newText = taskText.replace(new RegExp(`@${mention}`, 'g'), mention)
    await updateDoc(todoRef, { 
      mentions: newMentions,
      text: newText
    })
  }

  const renderHighlightedText = (text: string) => {
    // Split text by tags and mentions while preserving them
    // For mentions, only highlight when preceded by space or at start
    const parts = text.split(/(\s+|#\w+|(?:^|\s)@\w+)/)
    
    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return <span key={index} className="text-[#4CAF50] font-medium">{part}</span>
      } else if (part.match(/(?:^|\s)@\w+/)) {
        // Split the part into space and @mention
        const match = part.match(/^(\s*)(@\w+)$/)
        if (match) {
          return <span key={index}>{match[1]}<span className="text-[#2196F3] font-medium">{match[2]}</span></span>
        }
        return <span key={index} className="text-[#2196F3] font-medium">{part}</span>
      }
      return part
    })
  }

  const handleTaskDoubleClick = (todo: Todo) => {
    setEditingTaskId(todo.id)
    setEditingTaskText(todo.text)
  }

  const handleTaskTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingTaskText(e.target.value)
  }

  const handleTaskTextBlur = () => {
    if (editingTaskId !== null && editingTaskText.trim() !== '') {
      updateTaskText(editingTaskId, editingTaskText)
    }
    setEditingTaskId(null)
    setEditingTaskText('')
  }

  const handleTaskTextKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTaskTextBlur()
    } else if (e.key === 'Escape') {
      setEditingTaskId(null)
      setEditingTaskText('')
    }
  }

  const deleteTodo = async (id: string) => {
    await deleteDoc(doc(db, 'todos', id))
  }

  const handleRowFocus = (displayIndex: number) => {
    setSelectedTaskIndex(displayIndex)
  }

  const toggleSimpleView = () => {
    const newValue = !isSimpleView
    setIsSimpleView(newValue)
    localStorage.setItem('todoAppSimpleView', JSON.stringify(newValue))
  }

  const handleSort = (column: 'date' | 'status') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('asc')
    }
  }

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    if (draggedIndex === null) return

    // Clear sorting when manually reordering
    if (sortBy) {
      setSortBy(null)
    }

    const newTodos = [...todos]
    const draggedTodo = newTodos[draggedIndex]
    newTodos.splice(draggedIndex, 1)
    newTodos.splice(dropIndex, 0, draggedTodo)
    
    // Update order in Firestore
    const updates = newTodos.map((todo, index) => 
      updateDoc(doc(db, 'todos', todo.id), { order: index })
    )
    await Promise.all(updates)
    
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const toggleStatusFilter = (status: TodoStatus) => {
    if (filterStatuses.includes(status)) {
      setFilterStatuses(filterStatuses.filter(s => s !== status))
    } else {
      setFilterStatuses([...filterStatuses, status])
    }
  }

  const toggleAllStatuses = () => {
    const allStatuses: TodoStatus[] = ['not started', 'in progress', 'on hold', 'completed']
    // If all are already checked, do nothing (they're all selected)
    if (filterStatuses.length === allStatuses.length) {
      return
    }
    // Otherwise (whether none or some are checked), select all
    setFilterStatuses(allStatuses)
  }

  const isAllStatusesChecked = filterStatuses.length === 4

  const filteredTodos = todos.filter(todo => {
    // Status filter
    const statusMatch = filterStatuses.length === 0 || filterStatuses.includes(todo.status)
    
    // Tag filter (if any tags selected, todo must have at least one matching tag)
    const tagMatch = selectedTags.length === 0 || selectedTags.some(tag => (todo.tags || []).includes(tag))
    
    // Mention filter (if any mentions selected, todo must have at least one matching mention)
    const mentionMatch = selectedMentions.length === 0 || selectedMentions.some(mention => (todo.mentions || []).includes(mention))
    
    // Search query (searches in task text, tags, and mentions)
    const searchMatch = searchQuery.trim() === '' || 
      todo.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (todo.tags || []).some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (todo.mentions || []).some(mention => mention.toLowerCase().includes(searchQuery.toLowerCase()))
    
    return statusMatch && tagMatch && mentionMatch && searchMatch
  })

  const sortedTodos = [...filteredTodos].sort((a, b) => {
    if (!sortBy) return 0
    
    if (sortBy === 'date') {
      const comparison = a.dateCreated.localeCompare(b.dateCreated)
      return sortOrder === 'asc' ? comparison : -comparison
    } else {
      const statusOrder: TodoStatus[] = ['not started', 'in progress', 'on hold', 'completed']
      const aIndex = statusOrder.indexOf(a.status)
      const bIndex = statusOrder.indexOf(b.status)
      const comparison = aIndex - bIndex
      return sortOrder === 'asc' ? comparison : -comparison
    }
  })

  // Use original order for drag and drop, sorted order for display when sorted
  const displayTodos = sortBy ? sortedTodos : filteredTodos

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground p-5">
        <div className="flex justify-center items-center min-h-[70vh] text-lg text-white/70">
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  // Not authenticated - show sign in
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold text-foreground">rapi.do</h1>
            <p className="text-muted-foreground">A simple, powerful todo manager</p>
          </div>
          
          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="h-11"
            />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              minLength={6}
              className="h-11"
            />
            
            {authError && <p className="text-sm text-destructive text-center">{authError}</p>}
            
            <Button type="submit" className="w-full h-11" size="lg">
              {isSignUp ? 'Sign Up' : 'Sign In'}
            </Button>
            
            <Button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp)
                setAuthError('')
              }}
              variant="ghost"
              className="w-full"
            >
              {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
            </Button>
          </form>
        </div>
      </div>
    )
  }

  // Authenticated - show app
  return (
    <div className="min-h-screen bg-background text-foreground p-5">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 w-screen -ml-[calc(50vw-50%)] -mr-[calc(50vw-50%)] bg-background border-b border-border">
        {/* Row 1: Logo, User Info, Simple View Toggle */}
        <div className="max-w-[1200px] mx-auto px-5 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-foreground">rapi.do</h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{user.email}</span>
                <Button onClick={logout} variant="ghost" size="sm">
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </Button>
              </div>
              <label className="flex items-center gap-3 cursor-pointer select-none text-sm px-3 py-2 rounded-md hover:bg-accent transition-colors">
                <span className="text-foreground">Simple View</span>
                <input
                  type="checkbox"
                  checked={isSimpleView}
                  onChange={toggleSimpleView}
                  className="sr-only peer"
                />
                <div className="relative w-12 h-6 bg-muted rounded-full peer-checked:bg-primary transition-colors">
                  <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-6"></div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Row 2: Search and Add Task */}
        <div className="max-w-[1200px] mx-auto px-5 pb-2">
          <div className="flex items-center gap-3">
            {/* Add Task Button */}
            <Button onClick={() => setShowAddTaskModal(true)} variant="outline" className="gap-2 h-10">
              <Plus className="h-4 w-4" />
              Add Task
            </Button>

            {/* Search Bar */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks, #tags, or @mentions..."
                className="pl-9 h-10"
              />
            </div>

            {/* Status Filter Dropdown */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2 h-10">
                  <Filter className="h-4 w-4" />
                  Status {filterStatuses.length < 4 && `(${filterStatuses.length})`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={filterStatuses.includes('not started')}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setFilterStatuses([...filterStatuses, 'not started'])
                    } else {
                      setFilterStatuses(filterStatuses.filter(s => s !== 'not started'))
                    }
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  Not Started
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={filterStatuses.includes('in progress')}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setFilterStatuses([...filterStatuses, 'in progress'])
                    } else {
                      setFilterStatuses(filterStatuses.filter(s => s !== 'in progress'))
                    }
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  In Progress
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={filterStatuses.includes('on hold')}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setFilterStatuses([...filterStatuses, 'on hold'])
                    } else {
                      setFilterStatuses(filterStatuses.filter(s => s !== 'on hold'))
                    }
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  On Hold
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={filterStatuses.includes('completed')}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setFilterStatuses([...filterStatuses, 'completed'])
                    } else {
                      setFilterStatuses(filterStatuses.filter(s => s !== 'completed'))
                    }
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  Completed
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <div className="flex gap-2 px-2 py-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      toggleAllStatuses()
                    }}
                    className="flex-1 h-8"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setFilterStatuses([])
                    }}
                    className="flex-1 h-8"
                  >
                    Clear All
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Row 3: Active Filters */}
        {(filterStatuses.length > 0 && filterStatuses.length < 4) && (
          <div className="max-w-[1200px] mx-auto px-5 pb-4">
            <div className="flex flex-wrap gap-2">
              {filterStatuses.map(status => (
                <Badge key={status} variant="secondary" className="gap-1 pl-3 pr-1">
                  {status}
                  <button 
                    onClick={() => toggleStatusFilter(status)}
                    className="ml-1 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </header>
      
      <div className="max-w-[1200px] mx-auto px-5 pb-5">
        {/* Add Task Modal */}
        <Dialog open={showAddTaskModal} onOpenChange={setShowAddTaskModal}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Add New Task</DialogTitle>
              <DialogDescription>
                Create a new task. Press Enter or click Add to save.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 pt-4">
              <Input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="What needs to be done?"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    addTodo()
                    setShowAddTaskModal(false)
                  }
                }}
                autoFocus
                className="flex-1"
              />
              <Button 
                onClick={() => {
                  addTodo()
                  setShowAddTaskModal(false)
                }}
                className="px-6"
              >
                Add
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowAddTaskModal(false)}
              >
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>

      <div className="w-full bg-[#1e1e1e] rounded-lg overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="bg-[#1e1e1e]">
            <tr>
              <th className="w-[30px] px-1 py-4 text-left text-muted-foreground font-medium text-sm border-b border-[#2a2a2a]"></th>
              <th className="px-5 py-4 text-left text-muted-foreground font-medium text-sm border-b border-[#2a2a2a] capitalize">Task</th>
              {!isSimpleView && (
                <>
                  <th 
                    onClick={() => handleSort('status')} 
                    className="px-5 py-4 text-left text-muted-foreground font-medium text-sm border-b border-[#2a2a2a] capitalize cursor-pointer select-none transition-colors hover:text-foreground"
                  >
                    Status
                    {sortBy === 'status' && (
                      <span className="inline-block ml-1 text-primary text-xs">{sortOrder === 'asc' ? ' ▲' : ' ▼'}</span>
                    )}
                  </th>
                  <th className="px-5 py-4 text-left text-muted-foreground font-medium text-sm border-b border-[#2a2a2a] capitalize">Comment</th>
                  <th className="px-5 py-4 text-left text-muted-foreground font-medium text-sm border-b border-[#2a2a2a] capitalize">Tags</th>
                  <th className="px-5 py-4 text-left text-muted-foreground font-medium text-sm border-b border-[#2a2a2a] capitalize">Mentions</th>
                  <th 
                    onClick={() => handleSort('date')} 
                    className="px-5 py-4 text-left text-muted-foreground font-medium text-sm border-b border-[#2a2a2a] capitalize cursor-pointer select-none transition-colors hover:text-foreground"
                  >
                    Date Created
                    {sortBy === 'date' && (
                      <span className="inline-block ml-1 text-primary text-xs">{sortOrder === 'asc' ? ' ▲' : ' ▼'}</span>
                    )}
                  </th>
                </>
              )}
              <th className="px-5 py-4 text-left text-muted-foreground font-medium text-sm border-b border-[#2a2a2a]"></th>
            </tr>
          </thead>
          <tbody>
          {displayTodos.map((todo, displayIndex) => {
            const originalIndex = todos.findIndex(t => t.id === todo.id)
            const isDragging = draggedIndex === originalIndex
            const isDropTarget = dragOverIndex === originalIndex
            const isSelected = selectedTaskIndex === displayIndex
            
            // Status-based border colors and backgrounds
            const statusClasses = {
              'not started': 'border-l-[9px] border-l-[#6c757d]',
              'in progress': 'border-l-[9px] border-l-primary bg-primary/5 hover:bg-primary/10',
              'on hold': 'border-l-[9px] border-l-[#ffc107]',
              'completed': 'border-l-[9px] border-l-[#28a745] opacity-60'
            }
            
            return (
              <tr 
                key={todo.id} 
                className={`
                  bg-[#1e1e1e] transition-colors cursor-move
                  hover:bg-[#252525]
                  ${statusClasses[todo.status]}
                  ${isDragging ? 'opacity-40 bg-[#2a2a2a]' : ''}
                  ${isDropTarget ? 'border-t-[3px] border-t-primary bg-primary/15' : ''}
                  ${isSelected ? 'selected-task' : ''}
                `}
                draggable={!isMobile}
                onDragStart={() => handleDragStart(originalIndex)}
                onDragOver={(e) => handleDragOver(e, originalIndex)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, originalIndex)}
                onDragEnd={handleDragEnd}
              >
                <td className="px-1 py-3.5 border-b border-[#2a2a2a]">
                  <input
                    type="checkbox"
                    checked={todo.status === 'completed'}
                    onChange={() => toggleComplete(todo.id, todo.status, todo.previousStatus)}
                    onFocus={() => handleRowFocus(displayIndex)}
                    className="w-4 h-4 cursor-pointer accent-primary"
                  />
                </td>
                <td className={`px-5 py-3.5 border-b border-[#2a2a2a] min-w-[200px] text-[15px] text-foreground text-left cursor-pointer ${todo.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
                  {editingTaskId === todo.id ? (
                    <input
                      type="text"
                      value={editingTaskText}
                      onChange={handleTaskTextChange}
                      onBlur={handleTaskTextBlur}
                      onKeyDown={handleTaskTextKeyDown}
                      onFocus={() => handleRowFocus(displayIndex)}
                      className="w-full px-2 py-1 bg-[#2a2a2a] text-foreground border border-primary rounded font-inherit text-[15px] outline-none"
                      autoFocus
                    />
                  ) : (
                    <div
                      tabIndex={0}
                      className="px-2 py-1 -mx-2 -my-1 rounded outline-none cursor-text transition-all duration-200 hover:bg-white/[0.03] focus:bg-[#2196F3]/10 focus:shadow-[0_0_0_2px_rgba(33,150,243,0.3)]"
                      onDoubleClick={() => handleTaskDoubleClick(todo)}
                      onFocus={() => handleRowFocus(displayIndex)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleTaskDoubleClick(todo)
                        }
                      }}
                    >
                      {renderHighlightedText(todo.text)}
                    </div>
                  )}
                </td>
                {!isSimpleView && (
                  <>
                    <td className="px-5 py-3.5 border-b border-[#2a2a2a]">
                      <select 
                        value={todo.status} 
                        onChange={(e) => updateStatus(todo.id, e.target.value as TodoStatus)}
                        onFocus={() => handleRowFocus(displayIndex)}
                        className="w-full max-w-[150px] px-3 py-2 bg-[#2a2a2a] text-foreground border border-[#3a3a3a] rounded text-[13px] cursor-pointer hover:border-[#4a4a4a] focus:border-[#4a4a4a] focus:outline-none"
                      >
                        <option value="not started">Not Started</option>
                        <option value="in progress">In Progress</option>
                        <option value="on hold">On Hold</option>
                        <option value="completed">Completed</option>
                      </select>
                    </td>
                    <td className="px-5 py-3.5 border-b border-[#2a2a2a]">
                      <input
                        type="text"
                        value={todo.comment}
                        onChange={(e) => updateComment(todo.id, e.target.value)}
                        onFocus={() => handleRowFocus(displayIndex)}
                        placeholder="Add comment..."
                        className="w-full px-3 py-2 bg-transparent text-foreground border border-[#3a3a3a] rounded text-[13px] placeholder:text-white/30 focus:outline-none focus:border-primary focus:bg-[#252525]"
                      />
                    </td>
                    <td className="px-5 py-3.5 border-b border-[#2a2a2a]">
                      <div className="flex flex-wrap gap-1.5 items-center min-h-8">
                        {(todo.tags || []).map(tag => (
                          <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 rounded-xl text-xs font-medium whitespace-nowrap bg-[#4CAF50]/15 text-[#4CAF50] border border-[#4CAF50]/30">
                            #{tag}
                            <button 
                              onClick={() => removeTag(todo.id, tag, todo.tags || [], todo.text)}
                              className="bg-transparent border-none text-inherit cursor-pointer text-base leading-none p-0 ml-0.5 opacity-70 hover:opacity-100 transition-opacity duration-200"
                              title="Remove tag"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          placeholder="Add tag..."
                          className="bg-transparent border border-dashed border-[#3a3a3a] rounded px-2 py-1 text-white/60 text-xs outline-none min-w-20 max-w-[120px] focus:border-[#4a4a4a] focus:text-white/87 focus:bg-[#2a2a2a] placeholder:text-white/40"
                          onFocus={() => handleRowFocus(displayIndex)}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              const input = e.target as HTMLInputElement
                              if (input.value.trim()) {
                                addTag(todo.id, input.value.trim(), todo.tags || [])
                                input.value = ''
                              }
                            }
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-3.5 border-b border-[#2a2a2a]">
                      <div className="flex flex-wrap gap-1.5 items-center min-h-8">
                        {(todo.mentions || []).map(mention => (
                          <span key={mention} className="inline-flex items-center gap-1 px-2 py-1 rounded-xl text-xs font-medium whitespace-nowrap bg-[#2196F3]/15 text-[#2196F3] border border-[#2196F3]/30">
                            @{mention}
                            <button 
                              onClick={() => removeMention(todo.id, mention, todo.mentions || [], todo.text)}
                              className="bg-transparent border-none text-inherit cursor-pointer text-base leading-none p-0 ml-0.5 opacity-70 hover:opacity-100 transition-opacity duration-200"
                              title="Remove mention"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          placeholder="Add mention..."
                          className="bg-transparent border border-dashed border-[#3a3a3a] rounded px-2 py-1 text-white/60 text-xs outline-none min-w-20 max-w-[120px] focus:border-[#4a4a4a] focus:text-white/87 focus:bg-[#2a2a2a] placeholder:text-white/40"
                          onFocus={() => handleRowFocus(displayIndex)}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              const input = e.target as HTMLInputElement
                              if (input.value.trim()) {
                                addMention(todo.id, input.value.trim(), todo.mentions || [])
                                input.value = ''
                              }
                            }
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-3.5 border-b border-[#2a2a2a] text-muted-foreground text-[13px] whitespace-nowrap text-left">{todo.dateCreated}</td>
                  </>
                )}
                <td className="px-5 py-3.5 border-b border-[#2a2a2a]">
                  <button 
                    onClick={() => deleteTodo(todo.id)} 
                    onFocus={() => handleRowFocus(displayIndex)}
                    className="w-7 h-7 inline-flex items-center justify-center bg-transparent text-destructive border-none rounded p-1 text-2xl leading-none transition-all cursor-pointer hover:bg-destructive/10 hover:text-red-500"
                  >
                    ×
                  </button>
                </td>
            </tr>
            )
          })}
        </tbody>
      </table>
      </div>
      
      {displayTodos.length === 0 && todos.length > 0 && (
        <p className="text-center text-muted-foreground mt-5 italic">No tasks match the selected filters.</p>
      )}
      {todos.length === 0 && (
        <p className="text-center text-muted-foreground mt-5 italic">No tasks yet. Add one to get started!</p>
      )}
      </div> {/* end content-wrapper */}
    </div>
  )
}

export default App