"use strict";

/**
 * Base Adapter Interface for all A2A Mesh Agents.
 * Standardizes execution and health checks across heterogeneous runtimes.
 */
class BaseAdapter {
  constructor(id, name, role) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.status = "IDLE"; // IDLE, RUNNING, ERROR, OFFLINE
    this.lastActive = null;
  }

  /**
   * Execute task context through this adapter.
   * @param {Object} context - { prompt, code, fileUri, workspaceRoot, options }
   * @returns {Promise<{ success: boolean, text: string, diff?: string, metadata?: Object, error?: string }>}
   */
  async execute(context) {
    throw new Error(`execute() not implemented in adapter ${this.id}`);
  }

  /**
   * Check if runtime binary/credentials are available and functional.
   * @returns {Promise<{ available: boolean, status: string, details?: Object }>}
   */
  async checkHealth() {
    return { available: true, status: "READY" };
  }
}

module.exports = { BaseAdapter };
