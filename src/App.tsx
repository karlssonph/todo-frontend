import { useState, useEffect } from 'react'
import './App.css'
import { db } from './firebase'
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore'
import { useAuth } from './AuthContext'

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
  }, [selectedTaskIndex, editingTaskId, todos, filterStatuses, isMobile])

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
        return <span key={index} className="tag-highlight">{part}</span>
      } else if (part.match(/(?:^|\s)@\w+/)) {
        // Split the part into space and @mention
        const match = part.match(/^(\s*)(@\w+)$/)
        if (match) {
          return <span key={index}>{match[1]}<span className="mention-highlight">{match[2]}</span></span>
        }
        return <span key={index} className="mention-highlight">{part}</span>
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
    // If all are checked or none are checked, do nothing (keep showing all)
    if (filterStatuses.length === 0 || filterStatuses.length === allStatuses.length) {
      return
    }
    // If some are checked, select all
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
      <div className="App">
        <div className="loading-container">
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  // Not authenticated - show sign in
  if (!user) {
    return (
      <div className="App">
        <div className="auth-container">
          <h1>rapi.do</h1>
          <p>A simple, powerful todo manager</p>
          
          <form onSubmit={handleAuthSubmit} className="auth-form">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="auth-input"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              minLength={6}
              className="auth-input"
            />
            
            {authError && <p className="auth-error">{authError}</p>}
            
            <button type="submit" className="sign-in-btn">
              {isSignUp ? 'Sign Up' : 'Sign In'}
            </button>
            
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp)
                setAuthError('')
              }}
              className="toggle-auth-btn"
            >
              {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Authenticated - show app
  return (
    <div className="App">
      <div className="app-header">
        <h1>rapi.do</h1>
        <div className="header-right">
          <div className="user-info">
            <span className="user-name">{user.email}</span>
            <button onClick={logout} className="logout-btn">Sign Out</button>
          </div>
          <label className="view-toggle">
            <span>Simple View</span>
            <input
              type="checkbox"
              checked={isSimpleView}
              onChange={toggleSimpleView}
              className="toggle-checkbox"
            />
            <span className="toggle-switch"></span>
          </label>
        </div>
      </div>
      
      {/* Search and Add Task Row */}
      <div className="search-add-row">
        <div className="search-bar">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks, #tags, or @mentions..."
          />
        </div>
        <div className="filter-btn-container">
          <button 
            onClick={() => setShowStatusFilter(!showStatusFilter)} 
            className="filter-btn"
          >
            Status {filterStatuses.length < 4 && `(${filterStatuses.length})`}
            <span className={`dropdown-arrow ${showStatusFilter ? 'open' : ''}`}>▼</span>
          </button>
          
          {/* Status Filter Dropdown */}
          {showStatusFilter && (
            <div className="filter-dropdown">
              <label className="filter-option">
                <input 
                  type="checkbox" 
                  checked={filterStatuses.includes('not started')}
                  onChange={() => toggleStatusFilter('not started')}
                />
                <span>Not Started</span>
              </label>
              <label className="filter-option">
                <input 
                  type="checkbox" 
                  checked={filterStatuses.includes('in progress')}
                  onChange={() => toggleStatusFilter('in progress')}
                />
                <span>In Progress</span>
              </label>
              <label className="filter-option">
                <input 
                  type="checkbox" 
                  checked={filterStatuses.includes('on hold')}
                  onChange={() => toggleStatusFilter('on hold')}
                />
                <span>On Hold</span>
              </label>
              <label className="filter-option">
                <input 
                  type="checkbox" 
                  checked={filterStatuses.includes('completed')}
                  onChange={() => toggleStatusFilter('completed')}
                />
                <span>Completed</span>
              </label>
              <div className="filter-actions">
                <button 
                  onClick={toggleAllStatuses}
                  className="filter-action-btn"
                >
                  Select All
                </button>
                <button 
                  onClick={() => setFilterStatuses([])}
                  className="filter-action-btn"
                >
                  Clear All
                </button>
              </div>
            </div>
          )}
        </div>
        <button onClick={() => setShowAddTaskModal(true)} className="add-task-btn">
          <span>+</span>
          Add Task
        </button>
      </div>

      {/* Active Filters */}
      {(filterStatuses.length > 0 && filterStatuses.length < 4) && (
        <div className="active-filters">
          {filterStatuses.map(status => (
            <span key={status} className="active-filter-chip">
              {status}
              <button 
                onClick={() => toggleStatusFilter(status)}
                className="remove-filter"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add Task Modal */}
      {showAddTaskModal && (
        <>
          <div className="overlay" onClick={() => setShowAddTaskModal(false)}></div>
          <div className="add-task-panel">
            <h3>Add New Task</h3>
            <div className="add-task-input-row">
              <input
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
              />
              <button onClick={() => {
                addTodo()
                setShowAddTaskModal(false)
              }}>Add</button>
              <button className="cancel" onClick={() => setShowAddTaskModal(false)}>Cancel</button>
            </div>
          </div>
        </>
      )}

      <table className="todo-table">
        <thead>
          <tr>
            <th className="checkbox-column"></th>
            <th>Task</th>
            {!isSimpleView && (
              <>
                <th onClick={() => handleSort('status')} className="sortable">
                  Status
                  {sortBy === 'status' && (
                    <span className="sort-arrow">{sortOrder === 'asc' ? ' ▲' : ' ▼'}</span>
                  )}
                </th>
                <th>Comment</th>
                <th>Tags</th>
                <th>Mentions</th>
                <th onClick={() => handleSort('date')} className="sortable">
                  Date Created
                  {sortBy === 'date' && (
                    <span className="sort-arrow">{sortOrder === 'asc' ? ' ▲' : ' ▼'}</span>
                  )}
                </th>
              </>
            )}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {displayTodos.map((todo, displayIndex) => {
            const originalIndex = todos.findIndex(t => t.id === todo.id)
            const isDragging = draggedIndex === originalIndex
            const isDropTarget = dragOverIndex === originalIndex
            const isSelected = selectedTaskIndex === displayIndex
            
            return (
              <tr 
                key={todo.id} 
                className={`status-${todo.status.replace(' ', '-')} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''} ${isSelected ? 'selected-task' : ''}`}
                draggable={!isMobile}
                onDragStart={() => handleDragStart(originalIndex)}
                onDragOver={(e) => handleDragOver(e, originalIndex)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, originalIndex)}
                onDragEnd={handleDragEnd}
              >
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={todo.status === 'completed'}
                    onChange={() => toggleComplete(todo.id, todo.status, todo.previousStatus)}
                    onFocus={() => handleRowFocus(displayIndex)}
                    className="complete-checkbox"
                  />
                </td>
                <td className="task-cell">
                  {editingTaskId === todo.id ? (
                    <input
                      type="text"
                      value={editingTaskText}
                      onChange={handleTaskTextChange}
                      onBlur={handleTaskTextBlur}
                      onKeyDown={handleTaskTextKeyDown}
                      onFocus={() => handleRowFocus(displayIndex)}
                      className="task-edit-input"
                      autoFocus
                    />
                  ) : (
                    <div
                      tabIndex={0}
                      className="task-text-wrapper"
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
                    <td>
                      <select 
                        value={todo.status} 
                        onChange={(e) => updateStatus(todo.id, e.target.value as TodoStatus)}
                        onFocus={() => handleRowFocus(displayIndex)}
                        className="status-select"
                      >
                        <option value="not started">Not Started</option>
                        <option value="in progress">In Progress</option>
                        <option value="on hold">On Hold</option>
                        <option value="completed">Completed</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={todo.comment}
                        onChange={(e) => updateComment(todo.id, e.target.value)}
                        onFocus={() => handleRowFocus(displayIndex)}
                        placeholder="Add comment..."
                        className="comment-input"
                      />
                    </td>
                    <td>
                      <div className="badges-container">
                        {(todo.tags || []).map(tag => (
                          <span key={tag} className="badge tag-badge">
                            #{tag}
                            <button 
                              onClick={() => removeTag(todo.id, tag, todo.tags || [], todo.text)}
                              className="badge-remove"
                              title="Remove tag"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          placeholder="Add tag..."
                          className="badge-input"
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
                    <td>
                      <div className="badges-container">
                        {(todo.mentions || []).map(mention => (
                          <span key={mention} className="badge mention-badge">
                            @{mention}
                            <button 
                              onClick={() => removeMention(todo.id, mention, todo.mentions || [], todo.text)}
                              className="badge-remove"
                              title="Remove mention"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          placeholder="Add mention..."
                          className="badge-input"
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
                    <td className="date-cell">{todo.dateCreated}</td>
                  </>
                )}
                <td>
                  <button 
                    onClick={() => deleteTodo(todo.id)} 
                    onFocus={() => handleRowFocus(displayIndex)}
                    className="delete-btn"
                  >
                    ×
                  </button>
                </td>
            </tr>
            )
          })}
        </tbody>
      </table>
      
      {displayTodos.length === 0 && todos.length > 0 && (
        <p className="no-results">No tasks match the selected filters.</p>
      )}
      {todos.length === 0 && (
        <p className="no-results">No tasks yet. Add one to get started!</p>
      )}
    </div>
  )
}

export default App